class App {
  // These are not made private to expose them in the debug console
  help;
  snackBar;
  routeInfo;
  dateSelectors;
  selectedRoutes;
  stats;
  storage;
  search;
  groupSelector;
  map;
  maps;
  mapSelector;
  groups;
  routes;
  controller;

  shownMapId;

  constructor() {
    this.help = new Help();
    this.snackBar = new SnackBar()

    this.routeInfo = new RouteInfo();
    this.dateSelectors = new DateSelectors();
    this.selectedRoutes = new SelectedRoutes(this.dateSelectors, this.routeInfo, this.snackBar);

    this.groupSelector = new GroupSelector(this.selectedRoutes, this.snackBar);
    this.search = new Search(this.selectedRoutes);

    this.map = new MapUI(this.selectedRoutes, this.routeInfo);
    this.controller = new Controller(this.map);
    this.mapSelector = new MapSelector(this, this.snackBar);

    this.stats = new RouteStatistics(this.selectedRoutes, this.dateSelectors, this.map);

    this.maps = new Maps(this.snackBar);

    this.dateSelectors.setSelectedRoutes(this.selectedRoutes);
    this.routeInfo.setSelectedRoutes(this.selectedRoutes);
    this.selectedRoutes.setMap(this.map);

    this.#initStorage().then(() => {
      this.loadMap(null, true);
    });
  }

  async #initStorage() {
    this.storage = new Storage();

    await this.storage.connect();
    await this.storage.loadMaps(this.maps);
  }

  async loadMap(mapId, updatePos) {
    mapId = (mapId == null ? this.maps.get()[0].id : mapId);
    this.shownMapId = mapId;

    this.selectedRoutes.clear();
    this.map.clear();

    this.groups = new Groups(this.selectedRoutes, this.snackBar, mapId);
    this.routes = new Routes(this.dateSelectors, this.groups, this.map, this.snackBar);

    await this.storage.loadRoutes(mapId, this.routes);
    await this.storage.loadGroups(mapId, this.groups, this.routes);

    // Update existing objects
    this.dateSelectors.setRoutes(this.routes);
    this.groupSelector.setGroups(this.groups);
    this.mapSelector.setMaps(this.maps);
    this.search.setRoutes(this.routes);
    this.selectedRoutes.setRoutes(this.routes);
    this.stats.setRoutes(this.routes);
    this.controller.connect(this.dateSelectors, this.help, this.groupSelector, mapId, this.mapSelector,
                            this.routeInfo, this.routes, this.selectedRoutes, this.search, this.stats);

    this.dateSelectors.update();

    if (updatePos) {
      this.map.showCurrentPosition();
    }
  }
}

class FileParser {
  static async #parseRoutes(gpx, mapId) {
    let routes = [];

    let parser = new DOMParser();
    let gpxDOM = parser.parseFromString(gpx, "text/xml");

    let tracks = gpxDOM.getElementsByTagName("trk");
    for (let i = 0; i < tracks.length; i++) {
      let track = tracks[i];

      let name = "";
      let nameTag = track.getElementsByTagName("name")[0];
      if (nameTag) {
        name = nameTag.textContent;
      }

      let segments = track.getElementsByTagName("trkseg");
      for (let j = 0; j < segments.length; j++) {
        let segment = segments[j];

        let startTime;
        let endTime;
        let points = [];
        let pointTimestamps = []; 
        let trkpts = segment.getElementsByTagName("trkpt");
        for (let k = 0; k < trkpts.length; k++) {
          let trkpt = trkpts[k];
          let firstPoint = (k == 0);
          let lastPoint = (k == trkpts.length - 1);

          let lat = parseFloat(trkpt.getAttribute("lat"));
          let lon = parseFloat(trkpt.getAttribute("lon"));
          let time = null;

          let timeTags = trkpt.getElementsByTagName("time");
          if (timeTags.length > 0) {
            time = new Date(timeTags[0].textContent);
            if (firstPoint) {
              startTime = time;
            } else if (lastPoint) {
              endTime = time;
            }
          }

          let point = {
            lat: lat, lng: lon, timestamp: time
          };
          points.push(point);
        }

        let newRoute = {
          name: name,
          mapId: mapId,
          points: points,
          length: FileParser.#routeLength(points),
          startTime: startTime,
          endTime: endTime,
          hash: await FileParser.#routeHash(points, mapId),
          visible: true,
          selected: false
        };

        routes.push(newRoute);
      }
    }

    return routes;
  }

  static #degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
  }

 static #distanceInKmBetweenPoints(point1, point2) {
    let earthRadiusKm = 6371;

    let dLat = FileParser.#degreesToRadians(point2.lat-point1.lat);
    let dLng = FileParser.#degreesToRadians(point2.lng-point1.lng);

    let dLat1 = FileParser.#degreesToRadians(point1.lat);
    let dLat2 = FileParser.#degreesToRadians(point2.lat);

    let a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(dLat1) * Math.cos(dLat2); 
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return earthRadiusKm * c;
  }

  static #routeLength(points) {
    let length = 0;

    let prevPoint = points[0];

    for (let i = 1; i < points.length; i++) {
      length += FileParser.#distanceInKmBetweenPoints(prevPoint, points[i]);
      prevPoint = points[i];
    }

    return length;
  }

  static async #routeHash(points, mapId) {
    let pointMsg = points.map(point => point.lat + point.lng).toString();

    // encode as UTF-8
    const encoder = new TextEncoder();
    const msgBuffer = encoder.encode(pointMsg + "map" + mapId);

    // hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);

    // convert ArrayBuffer to Array
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // convert bytes to hex string
    const hashHex = hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
    return hashHex;
  }

  static #parseDroppedFile(file, mapId) {
    let reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async e => { 
        let routes = await FileParser.#parseRoutes(e.target.result, mapId);
        resolve(routes);
      }
      reader.readAsText(file);
    });
  }

  static parseDroppedFiles(files, mapId, callback) {
    let promises = [];
    for (let i = 0; i < files.length; i++) {
      promises.push(FileParser.#parseDroppedFile(files[i], mapId));
    }

    Promise.all(promises).then(routeFiles => {
      let newRoutes = [];
      for (let i = 0; i < routeFiles.length; i++) {
        for (let j = 0; j < routeFiles[i].length; j++) {
          newRoutes = newRoutes.concat(routeFiles[i][j]);
        }
      }

      if (newRoutes.length != 0) {
        callback(newRoutes);
      }
    });
  }
}


class Routes {
  #dateSelectors;
  #groups;
  #map;
  #snackBar;
  #storage;

  #allRoutes = [];

  #allYears = [];
  #allMonths = [];
  #allWeeks = [];

  constructor(dateSelectors, groups, map, snackBar) {
    this.#dateSelectors = dateSelectors;
    this.#groups = groups;
    this.#map = map;
    this.#snackBar = snackBar;
  }

  setStorage(storage) {
    this.#storage = storage;
  }

  #routeExists(route) {
    return this.#storage.lookupRoute(route, function(getter, resolve) {
      if (!getter.result) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }

  get(i = null) {
    if (i == null) {
      return this.#allRoutes;
    } else {
      return this.#allRoutes[i];
    }
  }

  push(route) {
    this.#allRoutes.push(route);
    this.#map.drawRoute(route);
  }

  count() {
    return this.#allRoutes.length;
  }

  async addRoutes(addedRoutes) {
    let newRoutes = [];

    for (let i = 0; i < addedRoutes.length; i++) {
      let route = addedRoutes[i];
      if (await this.#routeExists(route)) {
        console.log("Route already exists: " + route.name);
      } else {
        newRoutes.push(route);
        this.#map.drawRoute(route);
        this.addToDateOverview(route);
        this.#storage.addRoute(route);
      }
    }

    this.#allRoutes = this.#allRoutes.concat(newRoutes);

    this.#dateSelectors.update();

    return newRoutes;
  }

  async remove(routesToRemove) {
    let removedRoutes = [];
    let undoCallbacks = [];

    let routeGroups = {};
    for (const route of routesToRemove) {
      routeGroups[route.id] = this.#groups.findRouteGroups(route);
    }

    for (const route of routesToRemove) {
      this.#allRoutes = this.#allRoutes.filter(item => item !== route);
      this.#groups.removeRouteFromAllGroups(route);
      this.#map.removeRoute(route);

      let undo = await this.#storage.removeRoute(route);
      undoCallbacks.push(undo);
      
      removedRoutes.push(route);
    }

    this.#snackBar.showUndoRouteDelete(removedRoutes.length > 1, async (event) => {
      this.#allRoutes = this.#allRoutes.concat(removedRoutes);

      for (const undoCallback of undoCallbacks) {
        undoCallback();
      }

      for (const route of removedRoutes) {
        this.#map.drawRoute(route);
        this.addToDateOverview(route);

        for (const group of routeGroups[route.id]) {
          this.#groups.addRoutesToGroup(group, [route]);
        }
      }

      this.#dateSelectors.update();
    }, () => this.#storage.cleanUp());
  }

  addToDateOverview(route) {
    if (!route.startTime) return;

    addToSetArray(this.#allYears, route.startTime.getFullYear());
    addToSetArray(this.#allMonths, route.startTime.getMonth());
    addToSetArray(this.#allWeeks, route.startTime.getWeek());
  }

  rebuildDateOverview() {
    this.#allYears = [];
    this.#allMonths = [];
    this.#allWeeks = [];

    for (let i = 0; i < this.#allRoutes.length; i++) {
      this.addToDateOverview(this.#allRoutes[i]);
    }
  }

  findRoutesByIDs(routeIds) {
    let routeIdHash = {};
    for (let i = 0; i < this.count(); i++) {
      let route = this.get(i);
      routeIdHash[route.id] = route;
    }

    let foundRoutes = [];
    for (let i = 0; i < routeIds.length; i++) {
      let routeId = routeIds[i];
      if (routeIdHash.hasOwnProperty(routeId)) {
        foundRoutes.push(routeIdHash[routeId]);
      } else {
        console.log("Unknown route ID: " + routeId);
      }
    }

    return foundRoutes;
  }
}


class RouteStatistics {
  #longestYear;
  #longestMonth;
  #longestWeek;
  #longestRoute;
  #fastest5K;
  #fastest10K;
  #fastest20K;
  #fastest100K;
  #fastestMarathon;
  #totalDistance;
  #totalRoutes;

  #statsShown = false;
  #statsDialog;
  #statsDialogBody;

  #dateSelectors;
  #map;
  #routes;
  #selectedRoutes;

  constructor(selectedRoutes, dateSelectors, map) {
    this.#selectedRoutes = selectedRoutes;
    this.#dateSelectors = dateSelectors;
    this.#map = map;
    this.#statsDialog = document.querySelector("#statsDialog");
    this.#statsDialogBody = document.querySelector("#statsDialogBody");

    document.querySelector("#closeStatsBtn").addEventListener('click', this.hide.bind(this));
  }

  setRoutes(routes) {
    this.#routes = routes;
  }

  #clear() {
    this.#longestYear = null;
    this.#longestMonth = null;
    this.#longestWeek = null;
    this.#longestRoute = null;
    this.#fastest5K = null;
    this.#fastest10K = null;
    this.#fastest20K = null;
    this.#fastest100K = null;
    this.#fastestMarathon = null;
    this.#totalDistance = 0;
    this.#totalRoutes = 0;
  }

  #update(routes) {
    this.#clear();
    this.#buildRouteStats(routes);
    this.#buildDateStats(routes);
    this.#buildFastestRoutes(routes);
    this.#buildTable(routes);
  }

  #buildTable(routes) {
    let rows = [];

    this.#createTotalRows(rows, routes);
    this.#createDateRows(rows);
    this.#createLongestRouteRow(rows);
    this.#createFastestDistanceRows(rows);
    this.#statsDialogBody.replaceChildren(...rows);
  }

  #createTotalRows(rows, routes) {
    let selectAll = () => {
      this.hide();
      this.#selectedRoutes.set(routes);
    };
    rows.push(this.#createRow("Number of routes", this.#totalRoutes, selectAll));
    rows.push(this.#createRow("Total distance", `${this.#round(this.#totalDistance)} km`, selectAll));
  }

  #createDateRows(rows) {
    let showDate = (longestPeriod) => () => {
      if (longestPeriod == null) return;
      this.#dateSelectors.show();
      this.#dateSelectors.select(longestPeriod.date);
      this.hide();
    }

    rows.push(this.#createRow("Year with longest distance", 
      (this.#longestYear == null ? '-' : `${this.#longestYear.name} (${this.#round(this.#longestYear.length)} km)`), 
      showDate(this.#longestYear)));
    rows.push(this.#createRow("Month with longest distance", 
      (this.#longestMonth == null ? '-' : `${this.#longestMonth.name} (${this.#round(this.#longestMonth.length)} km)`), 
      showDate(this.#longestMonth)));
    rows.push(this.#createRow("Week with longest distance", 
      (this.#longestWeek == null ? '-' : `${this.#longestWeek.name} (${this.#round(this.#longestWeek.length)} km)`), 
      showDate(this.#longestWeek)));
  }

  #createLongestRouteRow(rows) {
    rows.push(this.#createRow("Longest route", 
      (this.#longestRoute == null ? '-' : `${this.#longestRoute.name} (${this.#round(this.#longestRoute.length)} km)`), 
      function () {
        this.hide();
        if (this.#longestRoute != null) {
          this.#selectedRoutes.set([this.#longestRoute]);
        }
      }.bind(this)));
  }

  #createFastestDistanceRows(rows) {
    rows.push(this.#createRow("Fastest 5 km", 
      (this.#fastest5K == null ? '-' : `${this.#fastest5K.route.name} (${this.#fastest5K.timeStr})`), 
      function() { this.#fastestDistanceClicked(this.#fastest5K); }.bind(this)));
    rows.push(this.#createRow("Fastest 10 km", 
      (this.#fastest10K == null ? '-' : `${this.#fastest10K.route.name} (${this.#fastest10K.timeStr})`), 
      function() { this.#fastestDistanceClicked(this.#fastest10K); }.bind(this)));
    rows.push(this.#createRow("Fastest 20 km", 
      (this.#fastest20K == null ? '-' : `${this.#fastest20K.route.name} (${this.#fastest20K.timeStr})`), 
      function() { this.#fastestDistanceClicked(this.#fastest20K); }.bind(this)));
    rows.push(this.#createRow("Fastest 100 km", 
      (this.#fastest100K == null ? '-' : `${this.#fastest100K.route.name} (${this.#fastest100K.timeStr})`), 
      function() { this.#fastestDistanceClicked(this.#fastest100K); }.bind(this)));
    rows.push(this.#createRow("Fastest marathon", 
      (this.#fastestMarathon == null ? '-' : `${this.#fastestMarathon.route.name} (${this.#fastestMarathon.timeStr})`), 
      function() { this.#fastestDistanceClicked(this.#fastestMarathon); }.bind(this)));
    
  }

  #createRow(description, value, callback) {
    let template = document.createElement('template');
    template.innerHTML = `<tr><td width='70% !important' style='text-overflow:ellipsis; overflow: hidden; max-width: 167px; white-space: nowrap;' class='mdl-data-table__cell--non-numeric'>${description}</td><td width='30% !important'>${value}</td></tr>`;
    if (callback != null) {
      template.content.firstChild.addEventListener("click", callback); 
    }
    return template.content.firstChild;
  }

  #fastestDistanceClicked(fastesDistance) {
    this.hide();
    if (fastesDistance != null) {
      this.#selectedRoutes.set([fastesDistance.route]);
      this.#map.drawRouteOverlay(fastesDistance.route, fastesDistance.start, fastesDistance.end);
    }
  }

  #buildFastestRoutes(routes) {
    this.#fastest5K = this.#fastestRoute(routes, 5);
    this.#fastest10K = this.#fastestRoute(routes, 10);
    this.#fastest20K = this.#fastestRoute(routes, 20);
    this.#fastest100K = this.#fastestRoute(routes, 100);
    this.#fastestMarathon = this.#fastestRoute(routes, 42.195);
  }

  #buildRouteStats(routes) {
    this.#totalRoutes = routes.length;
    if (this.#totalRoutes == 0) {
      this.#longestRoute = null;
      return;
    }

    this.#totalDistance = 0;
    this.#longestRoute = routes[0];
    for (const route of routes) {
      this.#totalDistance += route.length;
      if (route.length > this.#longestRoute.length) {
        this.#longestRoute = route;
      }
    }
  }

  #buildDateStats(routes) {
    let years = {};
    let months = {};
    let weeks = {};

    let monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    for (const route of routes) {
      if (!route.startTime) continue;

      let year = route.startTime.getFullYear();
      let month = route.startTime.getMonth();
      let week = route.startTime.getWeek();

      let yearName = "" + year;
      let monthName = monthNames[month] + " " + year;
      let weekName = "Week " + week + " " + year;

      this.#addToDateArray(years, yearName, route.length, { year: year, month: null, week: null});
      this.#addToDateArray(months, monthName, route.length, { year: year, month: month, week: null});
      this.#addToDateArray(weeks, weekName, route.length, { year: year, month: null, week: week});
    }

    this.#longestYear = this.#mapMax(years);
    this.#longestMonth = this.#mapMax(months);
    this.#longestWeek = this.#mapMax(weeks);
  }

  #addToDateArray(array, name, distance, date) {
    if (name in array) {
      array[name].length += distance;
    } else {
      array[name] = {
        name: name,
        length: distance,
        date: date
      };
    }
  }

  #mapMax(map) {
    let max = null;
    let maxLength = 0;

    for (const item in map) {
      if (map[item].length > maxLength) {
        max = map[item];
        maxLength = map[item].length
      }
    }

    return max;
  }

  #degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  #distanceInKmBetweenPoints(point1, point2) {
    let earthRadiusKm = 6371;

    let dLat = this.#degreesToRadians(point2.lat-point1.lat);
    let dLng = this.#degreesToRadians(point2.lng-point1.lng);

    let dLat1 = this.#degreesToRadians(point1.lat);
    let dLat2 = this.#degreesToRadians(point2.lat);

    let a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(dLat1) * Math.cos(dLat2); 
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return earthRadiusKm * c;
  }

  #fastestRoute(routes, distance) {
    let fastestRoute = null;
    routes.forEach(route => {
      let fastestStretch = this.#fastestStretch(route, distance);
      if (fastestRoute == null || (fastestStretch != null && fastestRoute.time > fastestStretch.time)) {
        fastestRoute = fastestStretch;
      }
    });
    return fastestRoute;
  }

  #fastestStretch(route, distance) {
    let curDistance = 0;
    let startIdx = 0;
    let points = route.points;
    let fastestTime = 0;
    let fastestTimeStartIdx = -1;
    let fastestTimeEndIdx = -1;

    let curIdx = 0;
    while (curIdx < points.length - 1) {
      while (curIdx < points.length - 1 && curDistance < distance) {
        curDistance += this.#distanceInKmBetweenPoints(points[curIdx], points[curIdx + 1]);
        curIdx++;
      }

      if (curDistance < distance) {
        break;
      }

      if (points[curIdx].timestamp == null) {
        return null;
      }

      let time = points[curIdx].timestamp - points[startIdx].timestamp;
      if (fastestTime == 0 || time < fastestTime) {
        fastestTime = time;
        fastestTimeStartIdx = startIdx;
        fastestTimeEndIdx = curIdx;
      }

      curDistance -= this.#distanceInKmBetweenPoints(points[startIdx], points[startIdx + 1]);
      startIdx += 1;
    }

    if (fastestTime == 0) {
      return null;
    } else {
      return { time: fastestTime, timeStr: this.#formatTime(fastestTime), start: fastestTimeStartIdx, end: fastestTimeEndIdx, route: route };
    }
  }

  #round(number) {
    return Math.round(number * 100) / 100;
  }
  
  #formatTime(timestampDiff) {
    let msPerSecond = 1000;
    let msPerMinute = msPerSecond * 60;
    let msPerHour = msPerMinute * 60;

    let hours = Math.floor(timestampDiff / msPerHour);
    timestampDiff -= hours * msPerHour;

    let minutes = Math.floor(timestampDiff / msPerMinute);
    timestampDiff -= minutes * msPerMinute;

    let seconds = Math.floor(timestampDiff / msPerSecond);

    return "" + hours + ":" + (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  hide() {
    this.#statsDialog.close();
    this.#statsShown = false;
  }

  show() {
    let selectedRoutes = this.#selectedRoutes.get();
    let routes = (selectedRoutes.length > 0 ? selectedRoutes : this.#routes.get());
    this.#update(routes);
    this.#statsDialog.showModal();
    this.#statsShown = true;
  }

  toggle() {
    if (this.#statsShown) {
      this.hide();
    } else {
      this.show();
    }
  }

  visible() {
    return this.#statsShown;
  }
}


class Controller {
  #dateSelectors;
  #groupSelector;
  #mapId;
  #mapSelector;
  #help;
  #search;
  #stats;
  #map;
  #routes;
  #routeInfo;
  #selectedRoutes;

  #ignoreDefaults(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  #mapKeyPress(event) {
    let key = event.keyCode || event.charCode;
    let keyHandled = true;

    if (this.#help.visible()) {
      if (key == 27) { // esc key
        this.#help.hide();
      }
    } else if (this.#search.visible()) {
      if (key == 27) { // esc key
        this.#search.hide();
      } else {
        keyHandled = false;
      }
    } else if (this.#stats.visible()) {
      if (key == 27 || key == 78) { // esc or 'n' key
        this.#stats.hide();
      }
    } else if (this.#groupSelector.visible()) {
      if (key == 27) { // esc key
        this.#groupSelector.hide();
      } else if (event.target != document.querySelector("#newGroupName")) {
        if (key == 71 || key == 65 || key == 82) { // 'g', 'a', or 'r' key
          this.#groupSelector.hide();
        }
      } else {
        keyHandled = false;
      }
    } else if (this.#mapSelector.visible()) {
      if (key == 27) { // esc key
        this.#mapSelector.hide();
      } else if (event.target != document.querySelector("#newMapName")) {
        if (key == 77) { // 'm' key
          this.#mapSelector.hide();
        }
      } else {
        keyHandled = false;
      }
    } else {
      if (key == 46) { // delete key
        this.#selectedRoutes.delete();
      } else if (key == 84) { // 't' key
        this.#map.toggleTrails();
      } else if (key == 27) { // esc key
        this.#selectedRoutes.clear();
      } else if (key == 72) { // 'h' key
        this.#map.toggleHiddenSelectedRoutes();
      } else if (key == 68) { // 'd' key
        this.#dateSelectors.toggle();
      } else if (key == 65) { // 'a' key
        this.#groupSelector.selectGroupToExtend();
      } else if (key == 82) { // 'r' key
        this.#groupSelector.selectGroupToRemove();
      } else if (key == 71) { // 'g' key
        this.#groupSelector.selectGroupToFocus();
      } else if (key == 77) { // 'm' key
        this.#mapSelector.selectMapToFocus();
      } else if (key == 83) { // 's' key
        this.#search.show();
      } else if (key == 78) { // 'n' key
        this.#stats.show();
      } else if (key == 73) { // 'i' key
        this.#routeInfo.toggleExtendedInfo();
      } else if (key == 18) { // alt key
        this.#map.enlargeRoutes();
      } else {
        keyHandled = false;
      }  
    }

    if (key == 17) { // ctrl key
      this.#map.enableSelectionBox(true);
    } else if (key == 191) { // '?' key
      this.#help.toggle();
    }

    if (keyHandled) {
      this.#ignoreDefaults(event);
    }
  }

  #mapKeyRelease(event) {
    let key = event.keyCode || event.charCode;
    if (key == 17) { // ctrl key
      this.#map.enableSelectionBox(false);
      this.#map.removeSelectionBox(false);
    } else if (key == 18) { // alt key
      this.#map.shrinkRoutes();
    }
  }

  #filesDropped(e) {
    e.stopPropagation();
    e.preventDefault();

    let files = e.target.files || e.dataTransfer.files;
    FileParser.parseDroppedFiles(files, this.#mapId, this.#showDroppedRoutes.bind(this));
  }

  #showDroppedRoutes(droppedRoutes) {
    this.#routes.addRoutes(droppedRoutes).then((newRoutes) => {
      this.#selectedRoutes.set(newRoutes);
    })
  }

  connect(dateSelectors, help, groupSelector, mapId, mapSelector, routeInfo, routes, selectedRoutes, search, stats) {
    this.#dateSelectors = dateSelectors;
    this.#groupSelector = groupSelector;
    this.#help = help;
    this.#mapId = mapId;
    this.#mapSelector = mapSelector;
    this.#routeInfo = routeInfo;
    this.#routes = routes;
    this.#selectedRoutes = selectedRoutes;
    this.#search = search;
    this.#stats = stats;
  }

  constructor(map) {
    this.#map = map;

    let mapDiv = map.getDiv();
    mapDiv.addEventListener("dragover", this.#ignoreDefaults.bind(this));
    mapDiv.addEventListener("dragenter", this.#ignoreDefaults.bind(this));
    mapDiv.addEventListener("dragleave", this.#ignoreDefaults.bind(this));
    mapDiv.addEventListener("drop", this.#filesDropped.bind(this));
    mapDiv.addEventListener("keydown", this.#mapKeyPress.bind(this));
    mapDiv.addEventListener("keyup", this.#mapKeyRelease.bind(this));

    document.body.addEventListener("keydown", this.#mapKeyPress.bind(this));
    document.body.addEventListener("keyup", this.#mapKeyRelease.bind(this));

    window.onblur = () => this.#map.shrinkRoutes();
  }
}

class Search {
  #searchShown = false;
  #searchDialog;
  #searchDialogInput;
  #searchDialogResults;
  #searcher;
  #routes;
  #selectedRoutes;

  constructor(selectedRoutes) {
    this.#selectedRoutes = selectedRoutes;

    this.#searchDialog = document.querySelector("#searchDialog");
    this.#searchDialogInput = document.querySelector("#searchDialogInput");
    this.#searchDialogResults = document.querySelector("#searchDialogResults");

    this.#searchDialogInput.addEventListener('keyup', this.update.bind(this));
    document.querySelector("#closeSearchBtn").addEventListener('click', this.hide.bind(this));
  }

  setRoutes(routes) {
    this.#routes = routes;
  }

  #round(number) {
    return Math.round(number * 100) / 100;
  }

  #prepare() {
    this.#searcher = new Fuse(this.#routes.get(), {keys:["name"], includeScore: true, includeMatches: true});
  }

  #routeSelected(route) {
    this.hide();
    this.#selectedRoutes.set([route]);
  }

  update() {
    let results = this.#searcher.search(this.#searchDialogInput.value);
    let count = 0;
    let rows = [];
    let template = document.createElement('template');

    results.forEach(result => {
      let route = result.item;
      if (count < 8) {
        if (result.score < 0.5) {
          template.innerHTML = "<tr><td width='70% !important' style='text-overflow:ellipsis; overflow: hidden; max-width: 167px; white-space: nowrap;' class='mdl-data-table__cell--non-numeric'>" + route.name + "</td><td width='30% !important'>" + this.#round(route.length) + " km</td></tr>";
          let row = template.content.firstChild;
          row.addEventListener('click', function() {
            this.#routeSelected(route);
          }.bind(this));
          rows.push(row);
          count++;
        }
      }
    });
    this.#searchDialogResults.replaceChildren(...rows);
  }

  hide() {
    this.#searchDialog.close();
    this.#searchShown = false;
  }

  show() {
    this.#prepare();
    this.#searchDialog.showModal();
    this.#searchShown = true;
  }

  toggle() {
    if (this.#searchShown) {
      this.hide();
    } else {
      this.show();
    }
  }

  visible() {
    return this.#searchShown;
  }
}

class Help {
  #helpShown = false;
  #helpBtn = null;
  #helpDialog = null;
  #closeHelpBtn = null;

  constructor() {
    this.#helpBtn = document.querySelector("#helpBtn");
    this.#helpDialog = document.querySelector("#helpDialog");
    this.#closeHelpBtn = document.querySelector("#closeHelpBtn");

    helpBtn.addEventListener('click', this.show.bind(this));
    closeHelpBtn.addEventListener('click', this.hide.bind(this));
  }

  hide() {
    this.#helpDialog.close();
    this.#helpShown = false;
  }

  show() {
    this.#helpDialog.showModal();
    this.#helpShown = true;
  }

  toggle() {
    if (this.#helpShown) {
      this.hide();
    } else {
      this.show();
    }
  }

  visible() {
    return this.#helpShown;
  }
}

class GroupSelector {
  #groups;
  #selectedRoutes;
  #snackBar;

  #groupSelectShown = false;
  #groupSelectorCallback = null;
  #groupSelectorGroups = null;
  #groupSelectorDelete = false;

  #groupDialog = null;
  #closeGroupBtn = null;
  #groupList = null;
  #newGroupName = null;
  #groupSelectorTitle = null;
  #newGroupContainer = null;

  #newGroupKeyUp(event) {
    let key = event.keyCode || event.charCode;
    if (key == 13) {
      if (this.#newGroupName.value.length > 0) {
        this.#groups.create(this.#newGroupName.value, () => this.update());
      }
    }
  }

  constructor(selectedRoutes, snackBar) {
    this.#selectedRoutes = selectedRoutes;
    this.#snackBar = snackBar;

    this.#closeGroupBtn = document.querySelector("#closeGroupBtn");
    this.#groupDialog = document.querySelector("#groupDialog");
    this.#groupList = document.querySelector(".groupList");
    this.#groupSelectorTitle = document.querySelector("#groupSelectorTitle");
    this.#newGroupContainer = document.querySelector("#newGroupContainer");
    this.#newGroupName = document.querySelector("#newGroupName");

    this.#closeGroupBtn.addEventListener('click', this.hide.bind(this));
    this.#newGroupName.addEventListener('keyup', this.#newGroupKeyUp.bind(this));
  }

  groupClick(id) {
    this.hide();
    if (this.#groupSelectorCallback) {
      this.#groupSelectorCallback(id);
    }
  }

  deleteClick(id) {
    this.hide();
    this.#groups.remove(id);
  }

  setGroups(groups) {
    this.#groups = groups;
  }

  update() {
    let groupListItems = "";
    for (let i = 0; i < this.#groupSelectorGroups.length; i++) {
      let group = this.#groupSelectorGroups[i];
      groupListItems += '<div class="groupListItem mdl-list__item"> \
          <span class="mdl-list__item-primary-content" onclick="app.groupSelector.groupClick(' + group.id + ')"> \
            <span>' + group.name + '</span> \
          </span>';
      if (this.#groupSelectorDelete) {
        groupListItems += '<a class="mdl-list__item-secondary-action" onclick="app.groupSelector.deleteClick(' + group.id + ')"><i class="material-icons">delete</i></a>';
      }
      groupListItems += '</div>';
    }

    this.#newGroupName.value = "";
    this.#newGroupName.parentElement.MaterialTextfield.change();
    this.#closeGroupBtn.focus();

    this.#groupList.innerHTML = groupListItems;
  }

  #show(callback, title, groups, newGroupInput, removeOption) {
    this.#groupSelectorCallback = callback;
    this.#groupSelectorGroups = groups;
    this.#groupSelectorDelete = removeOption;

    this.update();

    this.#groupSelectorTitle.innerText = title;
    this.#newGroupContainer.style.display = (newGroupInput ? "inline-block" : "none");

    this.#groupDialog.showModal();
    this.#closeGroupBtn.focus();
    this.#groupSelectShown = true;
  }

  hide() {
    this.#groupDialog.close();
    this.#groupSelectShown = false;
  }

  visible() {
    return this.#groupSelectShown;
  }

  selectGroupToFocus() {
    this.#show(function(id) { this.#groups.focusGroup(id) }, "Select Group", this.#groups.get(), true, true);
  }

  selectGroupToExtend() {
    if (this.#selectedRoutes.length() > 0) {
      if (this.#groups.get().length > 0) {
        this.#show(function(id) { this.#groups.addSelectedRoutesToGroup(id) }, "Add to Group", this.#groups.get(), false, false);
      } else {
        this.#snackBar.showErrorMsg("Create a group first by pressing 'g'");
      }
    } else {
      this.#snackBar.showErrorMsg("Select routes to add them to a group");
    }
  }

  selectGroupToRemove() {
    if (this.#selectedRoutes.length() > 0) {
      let selectedRoutesGroups = this.#groups.findRoutesGroups(this.#selectedRoutes.get());
      if (selectedRoutesGroups.length > 0) {
        this.#show(function(id) { this.#groups.removeSelectedRoutesFromGroup(id) }, "Remove from Group", selectedRoutesGroups, false, false);
      } else {
        this.#snackBar.showErrorMsg("The selected routes does not belong to any groups");
      }
    }
  }
}

class MapSelector {
  #app;
  #maps;
  #snackBar;

  #mapSelectShown = false;
  #mapSelectorCallback = null;
  #mapSelectorMaps = null;

  #mapDialog = null;
  #closeMapBtn = null;
  #mapList = null;
  #newMapName = null;
  #mapSelectorTitle = null;
  #newMapContainer = null;

  #newMapKeyUp(event) {
    let key = event.keyCode || event.charCode;
    if (key == 13) {
      if (this.#newMapName.value.length > 0) {
        this.hide();
        this.#maps.create(this.#newMapName.value, (newMapId) => {
          app.loadMap(newMapId, false);
        });
      }
    }
  }

  constructor(app, snackBar) {
    this.#app = app;
    this.#snackBar = snackBar;

    this.#closeMapBtn = document.querySelector("#closeMapBtn");
    this.#mapDialog = document.querySelector("#mapDialog");
    this.#mapList = document.querySelector(".mapList");
    this.#mapSelectorTitle = document.querySelector("#mapSelectorTitle");
    this.#newMapContainer = document.querySelector("#newMapContainer");
    this.#newMapName = document.querySelector("#newMapName");

    this.#closeMapBtn.addEventListener('click', this.hide.bind(this));
    this.#newMapName.addEventListener('keyup', this.#newMapKeyUp.bind(this));
  }

  setMaps(maps) {
    this.#maps = maps;
  }

  mapClick(id) {
    this.hide();
    if (this.#mapSelectorCallback) {
      this.#mapSelectorCallback(id);
    }
  }

  deleteClick(id) {
    this.hide();
    this.#maps.remove(id);
    this.#app.loadMap(null, false);
  }

  update() {
    let mapListItems = "";
    for (let i = 0; i < this.#mapSelectorMaps.length; i++) {
      let map = this.#mapSelectorMaps[i];
      mapListItems += '<div class="mapListItem mdl-list__item"> \
          <span class="mdl-list__item-primary-content" onclick="app.mapSelector.mapClick(' + map.id + ')"> \
            <span>' + (this.#app.shownMapId == map.id ? '<b>' : '') + map.name + (this.#app.shownMapId == map.id ? '</b>' : '') + '</span> \
          </span>';
      if (this.#mapSelectorMaps.length > 1) {
        mapListItems += '<a class="mdl-list__item-secondary-action" onclick="app.mapSelector.deleteClick(' + map.id + ')"><i class="material-icons">delete</i></a>';
      }
      mapListItems += '</div>';
    }

    this.#newMapName.value = "";
    this.#newMapName.parentElement.MaterialTextfield.change();
    this.#closeMapBtn.focus();

    this.#mapList.innerHTML = mapListItems;
  }

  #show(callback, title, maps, newMapInput) {
    this.#mapSelectorCallback = callback;
    this.#mapSelectorMaps = maps;

    this.update();

    this.#mapSelectorTitle.innerText = title;
    this.#newMapContainer.style.display = (newMapInput ? "inline-block" : "none");

    this.#mapDialog.showModal();
    this.#closeMapBtn.focus();
    this.#mapSelectShown = true;
  }

  hide() {
    this.#mapDialog.close();
    this.#mapSelectShown = false;
  }

  visible() {
    return this.#mapSelectShown;
  }

  selectMapToFocus() {
    this.#show(function(id) { this.#app.loadMap(id, false) }, "Select Map", this.#maps.get(), true);
  }
}


class DateSelectors {
  #routes;
  #selectedRoutes;

  #dateSelectorsDiv = null;
  #yearSelector = null;
  #monthSelector = null;
  #weekSelector = null;

  constructor() {
    this.#dateSelectorsDiv = document.querySelector("#dateSelectors");
    this.#yearSelector = document.querySelector("#yearSelector");
    this.#monthSelector = document.querySelector("#monthSelector");
    this.#weekSelector = document.querySelector("#weekSelector");

    this.#yearSelector.addEventListener('change', () => this.#dateSelectorsChanged(true, true));
    this.#monthSelector.addEventListener('change', () => this.#dateSelectorsChanged(false, true));
    this.#weekSelector.addEventListener('change', () => this.#dateSelectorsChanged(false, false));
  }

  setSelectedRoutes(selectedRoutes) {
    this.#selectedRoutes = selectedRoutes;
  }

  setRoutes(routes) {
    this.#routes = routes;
  }

  #getDateSelectorValues() {
    return {
      year: this.#yearSelector.value == "null" || this.#yearSelector.value == "" ? null : parseInt(this.#yearSelector.value),
      month: this.#monthSelector.value == "null" || this.#monthSelector.value == "" ? null : parseInt(this.#monthSelector.value),
      week: this.#weekSelector.value == "null" || this.#weekSelector.value == "" ? null : parseInt(this.#weekSelector.value)
    }
  }

  #dateSelectorsChanged(clearMonth, clearWeek) {
    if (clearMonth) this.#monthSelector.value = "null";
    if (clearWeek) this.#weekSelector.value = "null";

    let selectedDate = this.#getDateSelectorValues();
    this.#selectedRoutes.selectByYMW(selectedDate.year, selectedDate.month, selectedDate.week);
    this.update();
  }

  #getDateOptionsByYMW(year, month, week) {
    let filteredYears = [];
    let filteredMonths = [];
    let filteredWeeks = [];

    for (let i = 0; i < this.#routes.count(); i++) {
      let route = this.#routes.get(i);

      if ((route.startTime != null)) {
        addToSetArray(filteredYears, route.startTime.getFullYear());

        if (year == null || year == route.startTime.getFullYear()) {
          addToSetArray(filteredMonths, route.startTime.getMonth());
        }

        if ((year == null || year == route.startTime.getFullYear()) &&
            (month == null || month == route.startTime.getMonth())) {
          addToSetArray(filteredWeeks, route.startTime.getWeek());
        }
      }
    }

    return {
      years: filteredYears,
      months: filteredMonths,
      weeks: filteredWeeks
    }
  }

  select(date) {
    this.#yearSelector.value = "" + date.year;
    this.#monthSelector.value = "" + date.month;
    this.#weekSelector.value = "" + date.week;
    this.#dateSelectorsChanged(false, false);
  }

  clear() {
    this.#yearSelector.value = "null";
    this.#monthSelector.value = "null";
    this.#weekSelector.value = "null";
  }

  update() {
    let selectedDate = this.#getDateSelectorValues();
    let dateOptions = this.#getDateOptionsByYMW(selectedDate.year, selectedDate.month, selectedDate.week)

    removeOptionsFromSelect(this.#yearSelector);
    removeOptionsFromSelect(this.#monthSelector);
    removeOptionsFromSelect(this.#weekSelector);

    let monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    addArrayToSelect(dateOptions.years, this.#yearSelector, year => year);
    addArrayToSelect(dateOptions.months, this.#monthSelector, month => monthNames[month]);
    addArrayToSelect(dateOptions.weeks, this.#weekSelector, week => week);

    setSelectOptionIfPossible(this.#yearSelector, selectedDate.year);
    setSelectOptionIfPossible(this.#monthSelector, selectedDate.month);
    setSelectOptionIfPossible(this.#weekSelector, selectedDate.week);
  }

  toggle() {
    this.#dateSelectorsDiv.hidden = !this.#dateSelectorsDiv.hidden;
  }

  show() {
    this.#dateSelectorsDiv.hidden = false;
  }
}


class RouteInfo {
  #selectedRoutes;

  #currentHighlightedRoute = null;
  #extendedInfo = false;
  #routeInfoDiv = null;

  constructor() {
    this.#routeInfoDiv = document.getElementById("routeInfo");
    this.#routeInfoDiv.addEventListener("click", () => this.#selectedRoutes.clear());
  }

  setSelectedRoutes(selectedRoutes) {
    this.#selectedRoutes = selectedRoutes;
  }

  #round(number) {
    return Math.round(number * 100) / 100;
  }

  #getRoutesDuration(routes) {
    return routes.reduce(function (val, curRoute) {
      if (curRoute.startTime == null) {
        return val;
      } else {
        return val + (curRoute.endTime - curRoute.startTime);
      }
    }, 0);
  }

  #timeMsToStr(timeMs) {
    let msPerSecond = 1000;
    let msPerMinute = msPerSecond * 60;
    let msPerHour = msPerMinute * 60;
    let msPerDay = msPerHour * 24;

    let days = Math.floor(timeMs / msPerDay);
    timeMs -= days * msPerDay;

    let hours = Math.floor(timeMs / msPerHour);
    timeMs -= hours * msPerHour;

    let minutes = Math.floor(timeMs / msPerMinute);
    timeMs -= minutes * msPerMinute;

    return (days > 0 ? "<b>" + days + "</b> day" + (days != 1 ? "s " : " ") : "") +
      (days > 0 || hours > 0 ? "<b>" + hours + "</b> hour" + (hours != 1 ? "s " : " ") : "") +
      "<b>" + minutes + "</b> minute" + (minutes > 1 ? "s" : "");
  }

  toggleExtendedInfo() {
    if (this.#extendedInfo) {
      this.#routeInfoDiv.style.height = "20px";
    } else {
      this.#routeInfoDiv.style.height = "40px";
    }

    this.#extendedInfo = !this.#extendedInfo;
    this.update(this.#currentHighlightedRoute);
  }

  update(route) {
    this.#currentHighlightedRoute = null;

    if (route != null) {
      this.#currentHighlightedRoute = route;
      let time = this.#timeMsToStr(this.#getRoutesDuration([route]));
      this.#routeInfoDiv.innerHTML = route.name + " - <b>" + this.#round(route.length) + "</b> km" + 
        (this.#extendedInfo ? "<br/>" + route.startTime.toLocaleDateString("en-UK") + " - " + time : "");
    } else if (this.#selectedRoutes.length() == 1) {
      let time = this.#timeMsToStr(this.#getRoutesDuration(this.#selectedRoutes.get()));
      this.#routeInfoDiv.innerHTML = this.#selectedRoutes[0].name + " - <b>" + this.#round(this.#selectedRoutes[0].length) + "</b> km" + 
        (this.#extendedInfo ? "<br/>" + this.#selectedRoutes[0].startTime.toLocaleDateString("en-UK") + " - " + time : "");
    } else {
      if (this.#selectedRoutes.length() > 0) {
        let time = this.#timeMsToStr(this.#getRoutesDuration(this.#selectedRoutes.get()));
        this.#routeInfoDiv.innerHTML = "<b>" + this.#round(this.#selectedRoutes.length()) + "</b> km" + (this.#extendedInfo ? "<br/>" + time : "");
      } else {
        this.clear();
        return;
      }
    }
    this.#routeInfoDiv.style.display = "table-cell";
  }

  clear() {
    if (this.#selectedRoutes.length() == 0) {
      this.#routeInfoDiv.innerHTML = "";
      this.#routeInfoDiv.style.display = "none";
    }
  }
}


class SnackBar {
  #container = null;
  #hiddenTimer = null;

  constructor() {
    this.#container = document.querySelector("#snackbarDiv");
  }

  showErrorMsg(text) {
    this.#container.MaterialSnackbar.showSnackbar({
      message: text,
      timeout: 3000
    });
  }

  showUndoRouteDelete(plural, undoHandler, hiddenHandler) {
    this.#showUndoDelete(plural ? "Routes were deleted" : "Route was deleted", undoHandler, hiddenHandler);
  }

  showUndoMapDelete(undoHandler, hiddenHandler) {
    this.#showUndoDelete("Map was deleted", undoHandler, hiddenHandler);
  }

  showUndoGroupDelete(undoHandler, hiddenHandler) {
    this.#showUndoDelete("Group was deleted", undoHandler, hiddenHandler);
  }

  #showUndoDelete(message, undoHandler, hiddenHandler) {
    if (hiddenHandler) {
      this.#hiddenTimer = window.setTimeout(hiddenHandler, 6000);
    }

    this.#container.MaterialSnackbar.showSnackbar({
      message: message,
      timeout: 5000,
      actionText: "Undo",
      actionHandler: async event => {
        if (this.#hiddenTimer) {
          window.clearTimeout(this.#hiddenTimer);
          this.#hiddenTimer = null;
        }
        undoHandler(event);
        this.#container.MaterialSnackbar.cleanup_();
      }
    });
  }  
}


class SelectedRoutes {
  #dateSelectors;
  #map;
  #routeInfo;
  #routes;

  #allSelectedRoutes = [];
  #selectedRoutesLength = 0;

  constructor(dateSelectors, routeInfo) {
    this.#dateSelectors = dateSelectors;
    this.#routeInfo = routeInfo;
  }

  setMap(map) {
    this.#map = map;
  }

  setRoutes(routes) {
    this.#routes = routes;
  }

  get() {
    return this.#allSelectedRoutes;
  }

  clear(clearDate = true) {
    this.#allSelectedRoutes.forEach((route) => {
      route.selected = false;
      this.#map.updateRouteApperance(route, "default");
    });
    this.#selectedRoutesLength = 0;
    this.#allSelectedRoutes = [];
    this.#routeInfo.clear();
    this.#map.unhideAllRoutes();
    this.#map.removeRouteOverlay();
    if (clearDate) {
      this.#dateSelectors.clear();
    }
  }

  set(routes) {
    this.clear(false);
    this.#allSelectedRoutes = routes;
    this.#updateSelectedRoutesLength();
    this.#map.removeRouteOverlay();
    for (let i = 0; i < routes.length; i++) {
      routes[i].selected = true;
      this.#map.updateRouteApperance(routes[i], "selected");
    }
    this.#routeInfo.update(null);
    this.#map.zoomToRoutes(routes);
  }

  add(route) {
    if (this.#allSelectedRoutes.includes(route)) return;

    this.#allSelectedRoutes.push(route);
    route.selected = true;
    this.#map.removeRouteOverlay();
    this.#map.updateRouteApperance(route, "selected");
    this.#updateSelectedRoutesLength();
    this.#routeInfo.update(null);
  }

  remove(route) {
    if (!this.#allSelectedRoutes.includes(route)) return;

    this.#allSelectedRoutes = this.#allSelectedRoutes.filter(item => item !== route);
    route.selected = false;
    this.#map.removeRouteOverlay();
    this.#map.updateRouteApperance(route, "hovered");
    this.#updateSelectedRoutesLength();
    this.#routeInfo.update(route);
  }

  selectByYMW(year, month, week) {
    if (year == null && month == null && week == null) {
      this.clear();
      return;
    }

    let routesInDateRange = [];

    for (let i = 0; i < this.#routes.count(); i++) {
      let route = this.#routes.get(i);

      if ((route.startTime != null) && 
          (year == null || year == route.startTime.getFullYear()) &&
          (month == null || month == route.startTime.getMonth()) &&
          (week == null || week == route.startTime.getWeek())) {
        routesInDateRange.push(route);
      }
    }

    this.set(routesInDateRange);
    this.#map.zoomToRoutes(routesInDateRange);
  }

  length() {
    return this.#selectedRoutesLength;
  }

  selectInBounds(startLat, startLng, endLat, endLng) {
    let minLat = Math.min(startLat, endLat);
    let maxLat = Math.max(startLat, endLat);
    let minLng = Math.min(startLng, endLng);
    let maxLng = Math.max(startLng, endLng);

    for (let i = 0; i < this.#routes.count(); i++) {
      let curRoute = this.#routes.get(i);

      if (!curRoute.visible) {
        continue;
      }

      for (let j = 0; j < curRoute.points.length; j++) {
        let curPoint = curRoute.points[j];

        if (minLat < curPoint.lat && curPoint.lat < maxLat &&
            minLng < curPoint.lng && curPoint.lng < maxLng) {
          this.add(curRoute);
          break;
        }
      }
    }
  }

  includes(route) {
    return this.#allSelectedRoutes.includes(route);
  }

  #updateSelectedRoutesLength() {
    this.#selectedRoutesLength = this.#allSelectedRoutes.reduce(function (prev, cur) {
      return prev + cur.length;
    }, 0);
  }

  delete() {
    this.#routes.remove(this.#allSelectedRoutes);
    this.#allSelectedRoutes = [];
    this.#updateSelectedRoutesLength();
    this.#map.removeRouteOverlay();
    this.#routeInfo.clear();
    this.#routes.rebuildDateOverview();
    this.#dateSelectors.update();
  }
}

class Maps {
  #storage;
  #snackBar;

  #allMaps = [];

  constructor(snackBar) {
    this.#snackBar = snackBar;
  }

  setStorage(storage) {
    this.#storage = storage;
  }

  create(name, callback) {
    let map = {
      name: name
    };

    this.#allMaps.push(map);
    this.#storage.addMap(map, callback);
  }

  async remove(id) {
    let map = this.#findMap(id);
    this.#allMaps = this.#allMaps.filter(item => item !== map);
    let undoRemoveMap = await this.#storage.removeMap(map);

    this.#snackBar.showUndoMapDelete(async event => {
      this.#allMaps.push(map);
      undoRemoveMap();
    }, () => this.#storage.cleanUp());
  }

  get() {
    return this.#allMaps;
  }

  push(map) {
    this.#allMaps.push(map);
  }

  #findMap(id) {
    for (let i = 0; i < this.#allMaps.length; i++) {
      let map = this.#allMaps[i];
      if (map.id == id) {
        return map;
      }
    }
    throw "Unknown map ID " + id;
  }

  getName(id) {
    return this.#findMap(id).name;
  }
}

class Groups {
  #selectedRoutes;
  #snackBar;
  #storage;
  #mapId;

  #allGroups = [];

  constructor(selectedRoutes, snackBar, mapId) {
    this.#selectedRoutes = selectedRoutes;
    this.#snackBar = snackBar;
    this.#mapId = mapId;
  }

  setStorage(storage) {
    this.#storage = storage;
  }

  get() {
    return this.#allGroups;
  }

  push(group) {
    this.#allGroups.push(group);
  }

  create(name, callback) {
    let group = {
      name: name,
      mapId: this.#mapId,
      routes: []
    };

    this.#allGroups.push(group);
    this.#storage.addGroup(group, callback);
  }

  async remove(id) {
    let group = this.#findGroup(id);
    this.#allGroups = this.#allGroups.filter(item => item !== group);
    let undoRemoveGroup = await this.#storage.removeGroup(group);
    this.#selectedRoutes.clear();

    this.#snackBar.showUndoGroupDelete(async event => {
      this.#allGroups.push(group);
      undoRemoveGroup();
    }, () => this.#storage.cleanUp());
  }

  #findGroup(id) {
    for (let i = 0; i < this.#allGroups.length; i++) {
      let group = this.#allGroups[i];
      if (group.id == id) {
        return group;
      }
    }
    throw "Unknown group ID " + id;
  }

  #addRoutesToGroupId(id, routes) {
    this.addRoutesToGroup(this.#findGroup(id), routes);
  }

  addRoutesToGroup(group, routes) {
    for (let i = 0; i < routes.length; i++) {
      addToSetArray(group.routes, routes[i]);
    }

    this.#storage.updateGroup(group);
  }

  addSelectedRoutesToGroup(id) {
    this.#addRoutesToGroupId(id, this.#selectedRoutes.get());
    this.focusGroup(id);
  }

  #removeRoutesFromGroup(id, routes) {
    let group = this.#findGroup(id);

    for (let i = 0; i < routes.length; i++) {
      let route = routes[i];
      group.routes = group.routes.filter(item => item !== route);
    }

    this.#storage.updateGroup(group);
  }

  removeSelectedRoutesFromGroup(id) {
    this.#removeRoutesFromGroup(id, this.#selectedRoutes.get());
    this.focusGroup(id);
  }

  focusGroup(id) {
    let group = this.#findGroup(id);
    this.#selectedRoutes.set(group.routes);
  }

  removeRouteFromAllGroups(route) {
    for (const group of this.#allGroups) {
      let routeCountBefore = group.routes.length;
      group.routes = group.routes.filter(item => item !== route);

      let routeCountAfter = group.routes.length;
      if (routeCountBefore != routeCountAfter) {
        this.#storage.updateGroup(group);
      }
    }
  }

  findRouteGroups(route) {
    let foundGroups = [];

    for (let i = 0; i < this.#allGroups.length; i++) {
      let group = this.#allGroups[i];
      if (group.routes.includes(route)) {
        foundGroups.push(group);
      }
    }

    return foundGroups;
  }

  findRoutesGroups(routes) {
    let foundGroups = [];

    for (let i = 0; i < routes.length; i++) {
      let route = routes[i];
      let routeGroups = this.findRouteGroups(route);
      for (let j = 0; j < routeGroups.length; j++) {
        addToSetArray(foundGroups, routeGroups[j]);
      }
    }

    return foundGroups;
  }
}


class MapUI {
  #routeInfo;
  #selectedRoutes;

  #mapRef;
  #mapDiv;
  #hikingTrails = null;
  #routesEnlarged = false;
  #routesHidden = false;
  #drawnRoutes = [];
  #drawnOverlay = null;

  #routeStyles = {
    "default": {
      color: "#0000CC",
      weight: 2,
      opacity: 0.9,
      smothFactor: 1
    },
    "selected": {
      color: "#FFD90F",
      weight: 3,
      opacity: 0.9,
      smothFactor: 1
    },
    "hovered": {
      color: "#CC0000",
      weight: 3,
      opacity: 0.9,
      smothFactor: 1
    },
    "overlay": {
      color: "#EB9035",
      weight: 3,
      opacity: 1,
      smothFactor: 1
    },
  };

  #selectionBox = null;
  #selectionBoxEnabled = false;
  #selectionBoxStart = null;
  #selectionBoxEnd = null;

  #selectionBoxStyle = {
    color: "#6e8f5e",
    opacity: 0.4,
    weight: 2,
    fill: true,
    fillColor: "#6e8f5e",
    fillOpacity: 0.3 
  };

  constructor(selectedRoutes, routeInfo) {
    this.#routeInfo = routeInfo;
    this.#selectedRoutes = selectedRoutes;

    if (this.#mapDiv === undefined) {
      this.#mapDiv = document.getElementById("mapDiv");
      this.#mapRef = L.map('mapDiv')
    }

    this.#mapRef.setView({
      lat: 55.50841618187183,
      lng: 11.593322753906252
    }, 9);

    this.#mapRef.on('click', (ev) => {
      this.toggleSelectionBox(ev.latlng);
    });
    this.#mapRef.on('mousemove', (ev) => { this.updateSelectionBox(ev.latlng); });

    L.tileLayer('https://{s}.tile.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey={apikey}', {
      attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      apikey: '962b25ed041c480ca12771e771a48828',
      maxZoom: 22
    }).addTo(this.#mapRef);
  }

  drawRoute(route) {
    let path = L.polyline(route.points);
    let drawnRoute = {
      path: path,
      route: route,
      appearence: null,
      visible: true
    };
    this.#drawnRoutes.push(drawnRoute);

    this.#updateDrawnRouteApperance(drawnRoute, "default");
    path.addTo(this.#mapRef);

    path.on('mouseover', event => {
      this.#updateDrawnRouteApperance(drawnRoute, "hovered");
      this.#routeInfo.update(route);
    });

    path.on('mouseout', event => {
      if (this.#selectedRoutes.includes(route)) {
        this.#updateDrawnRouteApperance(drawnRoute, "selected");
      } else {
        this.#updateDrawnRouteApperance(drawnRoute, "default");
      }

      this.#routeInfo.update(null);
      this.#routeInfo.clear();
    });

    path.on('click', event => {
      if (!this.#selectedRoutes.includes(route)) {
        this.#selectedRoutes.add(route);
      } else {
        this.#selectedRoutes.remove(route);
      }
    });
  }

  drawRouteOverlay(route, fromIdx, toIdx) {
    this.removeRouteOverlay();

    let points = route.points.slice(fromIdx, toIdx + 1);
    let path = L.polyline(points);
    let drawnOverlay = {
      path: path,
      route: route,
      appearence: null,
      visible: true
    };
    this.#updateDrawnRouteApperance(drawnOverlay, "overlay");
    this.#drawnOverlay = drawnOverlay;
    path.addTo(this.#mapRef);
    path.bringToFront();
  }

  removeRoute(route) {
    let drawnRoute = this.#findDrawnRoute(route);
    drawnRoute.path.remove();
    this.#drawnRoutes = this.#drawnRoutes.filter(item => item !== drawnRoute);
  }

  clear() {
    for (const drawnRoute of this.#drawnRoutes) {
      drawnRoute.path.remove();
    }
    this.#drawnRoutes = [];
  }

  removeRouteOverlay() {
    if (this.#drawnOverlay == null) return;
    this.#drawnOverlay.path.remove();
    this.#drawnOverlay = null;
  }

  zoomToRoutes(routes) {
    if (routes == null || routes.length == 0) return;

    let bounds = this.#findDrawnRoute(routes[0]).path.getBounds();
    for (let i = 1; i < routes.length; i++) {
      bounds.extend(this.#findDrawnRoute(routes[i]).path.getBounds());
    }
    this.#mapRef.flyToBounds(bounds);
  }

  #zoomToPoint(lat, lng) {
    this.#mapRef.flyTo(L.latLng(lat, lng));
  }

  showCurrentPosition() {
    let locationFound = position => {
      let lat = position.coords.latitude;
      let lng = position.coords.longitude;
      this.#zoomToPoint(lat, lng);
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(locationFound);
    }
  }

  #addTrails() {
    this.#hikingTrails = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map style: &copy; <a href="https://waymarkedtrails.org">waymarkedtrails.org</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    }).addTo(this.#mapRef);
  }

  #removeTrails() {
    if (this.#hikingTrails) {
      this.#hikingTrails.remove();
      this.#hikingTrails = null;
    }
  }

  toggleTrails() {
    if (this.#hikingTrails) {
      this.#removeTrails();
    } else {
      this.#addTrails();
    }
  }

  #findDrawnRoute(route) {
    for (const drawnRoute of this.#drawnRoutes) {
      if (drawnRoute.route == route) {
        return drawnRoute;
      }
    }
  }

  updateRouteApperance(route, appearence) {
    this.#updateDrawnRouteApperance(this.#findDrawnRoute(route), appearence);
  }

  #updateDrawnRouteApperance(drawnRoute, appearence) {
    drawnRoute.appearence = appearence;

    drawnRoute.path.setStyle(this.#routeStyles[appearence]);
    if (appearence == "default") {
      drawnRoute.path.bringToBack();
    } else {
      drawnRoute.path.bringToFront();
    }
    
    if (this.#drawnOverlay != null) {
      this.#drawnOverlay.path.bringToFront();
    }
  }

  #changeRouteWidth(diff) {
    this.#routeStyles["default"].weight += diff;
    this.#routeStyles["selected"].weight += diff;
    this.#routeStyles["hovered"].weight += diff;
    this.#routeStyles["overlay"].weight += diff;

    for (let i = 0; i < this.#drawnRoutes.length; i++) {
      this.#updateDrawnRouteApperance(this.#drawnRoutes[i], this.#drawnRoutes[i].appearence);
    }

    if (this.#drawnOverlay != null) {
      this.#updateDrawnRouteApperance(this.#drawnOverlay, this.#drawnOverlay.appearence);
    }
  }

  enlargeRoutes() {
    if (this.#routesEnlarged) return;
    this.#changeRouteWidth(2);
    this.#routesEnlarged = true;
  }

  shrinkRoutes() {
    if (!this.#routesEnlarged) return;
    this.#changeRouteWidth(-2);
    this.#routesEnlarged = false;
  }

  enableSelectionBox(enabled) {
    this.#selectionBoxEnabled = enabled;
    this.#setCursor(enabled ? "pointer" : "");
  }

  createSelectionBox(startLatLng) {
    if (!this.#selectionBoxEnabled) return;

    this.#selectionBoxStart = startLatLng;
    let boxBounds = L.latLngBounds(this.#selectionBoxStart, this.#selectionBoxStart);
    this.#selectionBox = L.rectangle(boxBounds, this.#selectionBoxStyle).addTo(this.#mapRef);
  }

  updateSelectionBox(newLatLng) {
    if (!this.#selectionBox) return;

    this.#selectionBoxEnd = newLatLng;
    this.#selectionBox.setBounds(L.latLngBounds(this.#selectionBoxStart, this.#selectionBoxEnd));
  }

  removeSelectionBox(addRoutes) {
    if (!this.#selectionBox) return;

    if (addRoutes) {
      this.#selectedRoutes.selectInBounds(this.#selectionBoxStart.lat, this.#selectionBoxStart.lng, 
                                          this.#selectionBoxEnd.lat, this.#selectionBoxEnd.lng);
    }

    this.#selectionBox.remove();
    this.#selectionBox = null;
  }

  toggleSelectionBox(latlng) {
    if (this.#selectionBox) {
      this.removeSelectionBox(true);
    } else { 
      this.createSelectionBox(latlng); 
    }
  }

  getDiv() {
    return this.#mapDiv;
  }

  #setCursor(cursorStyle) {
    this.#mapDiv.style.cursor = cursorStyle;
  }

  unhideAllRoutes() {
    if (!this.#routesHidden) return;
    
    this.#drawnRoutes.forEach(drawnRoute => { 
      if (!drawnRoute.visible) {
        drawnRoute.visible = true;
        drawnRoute.path.addTo(this.#mapRef);
      }
    });

    this.#selectedRoutes.get().forEach(route => this.#findDrawnRoute(route).path.bringToFront());

    this.#routesHidden = false;
  }

  #hideOtherRoutes(visibleRoutes) {
    if (this.#routesHidden) return;

    let nonVisibleRoutes = this.#drawnRoutes.filter(drawnRoute => !visibleRoutes.includes(drawnRoute.route));
    nonVisibleRoutes.forEach(drawnRoute => {
      drawnRoute.visible = false;
      drawnRoute.path.remove()
    });

    this.#routesHidden = true;
  }

  toggleHiddenSelectedRoutes() {
    if (this.#routesHidden) {
      this.unhideAllRoutes();
    } else {
      if (this.#selectedRoutes.length() > 0) {
        this.#hideOtherRoutes(this.#selectedRoutes);
      }
    }
  }
}


class Storage {
  #db = null;

  connect(callback) {
    return new Promise((resolve, reject) => {
      let openRequest = indexedDB.open("routeDB", 4);

      openRequest.onupgradeneeded = event => {
        this.#db = event.target.result; 
        if (!this.#db.objectStoreNames.contains('routes')) {  
          let objectStore = this.#db.createObjectStore('routes', { keyPath: 'id', autoIncrement: true});
          objectStore.createIndex("hash", "hash", {unique: true});
        }

        if (!this.#db.objectStoreNames.contains('groups')) {  
          let objectStore = this.#db.createObjectStore('groups', { keyPath: 'id', autoIncrement: true});
        }

        if (!this.#db.objectStoreNames.contains('maps')) {  
          let objectStore = this.#db.createObjectStore('maps', { keyPath: 'id', autoIncrement: true});
        }
      }

      openRequest.onerror = () => { 
        console.error("Unable to access database", openRequest.error);
        reject();
      };
      
      openRequest.onsuccess = (event) => { 
        this.#db = event.target.result;

        this.cleanUp();

        resolve();
      }
    });
  }

  async loadRoutes(mapId, routes) {
    routes.setStorage(this);

    return new Promise((resolve, reject) => {
      let readTransaction = this.#db.transaction("routes");
      let objectStore = readTransaction.objectStore("routes");
      objectStore.openCursor().onsuccess = (event) => {
        let cursor = event.target.result;
        if (cursor) {
          let route = cursor.value;
          if (!route.deleted && route.mapId == mapId) {
            route.selected = false;
            route.visible = true;
            routes.addToDateOverview(route);
            routes.push(route);
          }
          cursor.continue();
        }
      }

      readTransaction.oncomplete = event => {
        resolve();
      }
    });
  }

  async loadGroups(mapId, groups, routes) {
    groups.setStorage(this);

    return new Promise((resolve, reject) => {
      let readTransaction = this.#db.transaction("groups");
      let objectStore = readTransaction.objectStore("groups");
      objectStore.openCursor().onsuccess = (event) => {
        let cursor = event.target.result;
        if (cursor) {
          let dbGroup = cursor.value;
          if (!dbGroup.deleted && dbGroup.mapId == mapId) {
            groups.push({
              name: dbGroup.name,
              mapId: dbGroup.mapId,
              routes: routes.findRoutesByIDs(dbGroup.routeIds),
              id: dbGroup.id,
              deleted: false
            });
          }

          cursor.continue();
        }
      }

      readTransaction.oncomplete = event => {
        resolve();
      }
    });
  }

  async loadMaps(maps) {
    maps.setStorage(this);

    return new Promise((resolve, reject) => {
      let readTransaction = this.#db.transaction("maps");
      let objectStore = readTransaction.objectStore("maps");
      let firstMapId = null;

      objectStore.openCursor().onsuccess = (event) => {
        let cursor = event.target.result;
        if (cursor) {
          let dbMap = cursor.value;

          if (!dbMap.deleted) {
            maps.push({
              name: dbMap.name,
              id: dbMap.id
            });

            if (firstMapId == null) {
              firstMapId = dbMap.id;
            }
          }
  
          cursor.continue();
        } else {
          if (maps.get().length == 0) {
            let defaultMap = {
              name: "Default map",
              deleted: false
            };

            maps.push(defaultMap);
            this.addMap(defaultMap, () => resolve());
          } else {
            resolve();
          }
        }
      }
    });
  }

  #dbGroupFromGroup(group, addId) {
    let dbGroup = {
      name: group.name,
      mapId: group.mapId,
      routeIds: group.routes.map(route => route.id),
      deleted: group.deleted ? true : false
    };
    
    if (addId) {
      dbGroup.id = group.id;
    }

    return dbGroup;
  }

  cleanUp() {
    this.#cleanUpTable("routes");
    this.#cleanUpTable("maps");
    this.#cleanUpTable("groups");
  }

  #cleanUpTable(tableName) {
    let transaction = this.#db.transaction([tableName], "readwrite");
    let objectStore = transaction.objectStore(tableName);
    let request = objectStore.getAll();

    request.onsuccess = async function(event) {
      event.target.result.forEach(function(record) {
        if (record.deleted) {
          objectStore.delete(record.id);
        }
      })
    }

  }

  #dbUpdate(accessType, tableName, obj, callback) {
    let transaction = this.#db.transaction([tableName], "readwrite");

    transaction.onerror = function(event)  { 
      console.error("Unable to access database", event); 
    };

    let objectStore = transaction.objectStore(tableName);
    let request = objectStore[accessType](obj);
    request.onsuccess = async function(event) {
      if (callback) {
        callback(event.target.result);
      }
    };
  }

  addGroup(group, callback) {
    let dbGroup = this.#dbGroupFromGroup(group, false);

    this.#dbUpdate("add", "groups", dbGroup, (groupId) => {
      group.id = groupId;
      callback();
    });
  }

  updateGroup(group) {
    return new Promise((resolve, reject) => {
      let dbGroup = this.#dbGroupFromGroup(group, true);

      this.#dbUpdate("put", "groups", dbGroup, resolve);
    });
  }

  async removeGroup(group) {
    group.deleted = true;
    await this.updateGroup(group);

    return async () => {
      group.deleted = false;
      await this.updateGroup(group);
    }
  }

  addMap(map, callback) {
    let dbMap = {
      name: map.name,
      deleted: false
    };

    this.#dbUpdate("add", "maps", dbMap, (mapId) => {
      map.id = mapId;
      callback();
    })
  }

  updateMap(map) {
    return new Promise((resolve, reject) => {
      this.#dbUpdate("put", "maps", map, resolve);
    });
  }

  async removeMap(map) {
    map.deleted = true;
    await this.updateMap(map);

    return async () => {
      map.deleted = false;
      await this.updateMap(map);
    }
  }

  #dbRouteFromRoute(route, addId) {
    let dbRoute = {
      name: route.name,
      mapId: route.mapId,
      length: route.length,
      points: route.points,
      startTime: route.startTime,
      endTime: route.endTime,
      hash: route.hash,
      deleted: route.deleted ? true : false
    };
    
    if (addId) {
      dbRoute.id = route.id;
    }

    return dbRoute;
  }

  addRoute(route) {
    let dbRoute = this.#dbRouteFromRoute(route, false);

    this.#dbUpdate("add", "routes", dbRoute, (routeId) => route.id = routeId);
  }

  updateRoute(route) {
    return new Promise((resolve, reject) => {
      let dbRoute = this.#dbRouteFromRoute(route, true);

      this.#dbUpdate("put", "routes", route, resolve);
    });
  }

  async removeRoute(route) {
    route.deleted = true;
    await this.updateRoute(route);

    return async () => {
      route.deleted = false;
      await this.updateRoute(route);
    }
  }

  lookupRoute(route, callback) {
    let transaction = this.#db.transaction(["routes"], "readwrite");
    let objectStore = transaction.objectStore("routes");
    let hashIndex = objectStore.index('hash');

    return new Promise((resolve, reject) => {
      let getter = hashIndex.get(route.hash);

      getter.onsuccess = function(event) {
        callback(getter, resolve);
      }

      getter.onerror = function(event) {
        console.log("Unable to access database", event);
        reject();
      }
    });
  }
}


/******** Utils ***********/
function addToSetArray(array, item) {
  if (array.indexOf(item) === -1) {
    array.push(item);
  }
}

function addOptionToSelect(select, text, value) {
  let option = document.createElement("option");
  option.text = text;
  option.value = value;
  select.add(option);
}

function removeOptionsFromSelect(select) {
  for (let i = select.options.length - 1; i >= 0; i--) {
    select.remove(i);
  }
}

function selectHasOption(select, option) {
  for (let i = select.options.length - 1; i >= 0; i--) {
    if (select.options[i].value == option) {
      return true;
    }
  }
  return false;
}

function setSelectOptionIfPossible(select, option) {
  select.value = (selectHasOption(select, option) && option != null ? option : "null");
}

function addArrayToSelect(array, select, textGenerator) {
  array.sort(function( a , b){
    if(a > b) return 1;
    if(a < b) return -1;
    return 0;
  });

  addOptionToSelect(select, "---", null);
  for (let i = 0; i < array.length; i++) {
    addOptionToSelect(select, textGenerator(array[i]), array[i]);
  }
}

// Source: https://weeknumber.com/how-to/javascript
// Returns the ISO week of the date.
Date.prototype.getWeek = function() {
  let date = new Date(this.getTime());
  date.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  // January 4 is always in week 1.
  let week1 = new Date(date.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and count number of weeks from date to week1.
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000
                        - 3 + (week1.getDay() + 6) % 7) / 7);
}

