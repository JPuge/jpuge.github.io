class App {
  // These are not made private to expose them in the debug console
  help;
  snackBar;
  routeInfo;
  dateSelectors;
  selectedRoutes;
  fileParser;
  storage;
  groupSelector;
  map;
  groups;
  routes;
  controller;

  constructor() {
    this.help = new Help();
    this.snackBar = new SnackBar()

    this.routeInfo = new RouteInfo();
    this.dateSelectors = new DateSelectors();
    this.selectedRoutes = new SelectedRoutes(this.dateSelectors, this.routeInfo, this.snackBar);

    this.groups = new Groups(this.selectedRoutes, this.snackBar);
    this.groupSelector = new GroupSelector(this.groups, this.selectedRoutes, this.snackBar);

    this.map = new MapUI(this.selectedRoutes, this.routeInfo);
    this.routes = new Routes(this.dateSelectors, this.groups, this.map);

    this.storage = new Storage(this.routes, this.groups, this.dateSelectors);
    this.fileParser = new FileParser(this.routes, this.selectedRoutes);

    this.controller = new Controller(this.dateSelectors, this.fileParser, 
                                      this.help, this.groupSelector, this.map, 
                                      this.routeInfo, this.selectedRoutes);

    this.dateSelectors.setSelectedRoutes(this.selectedRoutes);
    this.dateSelectors.setRoutes(this.routes);
    this.groups.setStorage(this.storage);
    this.routes.setStorage(this.storage);
    this.routeInfo.setSelectedRoutes(this.selectedRoutes);
    this.selectedRoutes.setGroups(this.groups);
    this.selectedRoutes.setMap(this.map);
    this.selectedRoutes.setRoutes(this.routes);

    this.storage.load();
    this.map.showCurrentPosition();
  }
}

class FileParser {
  #routes;
  #selectedRoutes;

  constructor(routes, selectedRoutes) {
    this.#routes = routes;
    this.#selectedRoutes = selectedRoutes;
  }

  async #parseRoutes(gpx) {
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
        let trkpts = segment.getElementsByTagName("trkpt");
        for (let k = 0; k < trkpts.length; k++) {
          let trkpt = trkpts[k];
          let firstPoint = (k == 0);
          let lastPoint = (k == trkpts.length - 1);

          let lat = parseFloat(trkpt.getAttribute("lat"));
          let lon = parseFloat(trkpt.getAttribute("lon"));
          let point = {
            lat: lat, lng: lon
          };
          points.push(point);

          let timeTags = trkpt.getElementsByTagName("time");
          if (timeTags.length > 0) {
            let time = new Date(timeTags[0].textContent);
            if (firstPoint) {
              startTime = time;
            } else if (lastPoint) {
              endTime = time;
            }
          }
        }

        let newRoute = {
          name: name,
          points: points,
          length: this.#routeLength(points),
          startTime: startTime,
          endTime: endTime,
          hash: await this.#routeHash(points),
          visible: true,
          selected: false
        };

        routes.push(newRoute);
      }
    }

    return routes;
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

  #routeLength(points) {
    let length = 0;

    let prevPoint = points[0];

    for (let i = 1; i < points.length; i++) {
      length += this.#distanceInKmBetweenPoints(prevPoint, points[i]);
      prevPoint = points[i];
    }

    return length;
  }

  async #routeHash(points) {
    let pointMsg = points.map(point => point.lat + point.lng).toString();

    // encode as UTF-8
    const msgBuffer = new TextEncoder().encode(pointMsg);

    // hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);

    // convert ArrayBuffer to Array
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // convert bytes to hex string
    const hashHex = hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
    return hashHex;
  }

  async #addGpxFile(gpxRoute) {
    let fileRoutes = await this.#parseRoutes(gpxRoute);
    return await this.#routes.addRoutes(fileRoutes);
  }

  #parseDroppedFile(file) {
    let reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async e => { 
        let routes = await this.#addGpxFile(e.target.result);
        resolve(routes);
      }
      reader.readAsText(file);
    });
  }

  parseDroppedFiles(files) {
    let promises = [];
    for (let i = 0; i < files.length; i++) {
      promises.push(this.#parseDroppedFile(files[i]));
    }

    Promise.all(promises).then(routeFiles => {
      let newRoutes = [];
      for (let i = 0; i < routeFiles.length; i++) {
        for (let j = 0; j < routeFiles[i].length; j++) {
          newRoutes = newRoutes.concat(routeFiles[i][j]);
        }
      }

      if (newRoutes.length != 0) {
        this.#selectedRoutes.set(newRoutes);
      }
    });
  }
}


class Routes {
  #dateSelectors;
  #groups;
  #map;
  #storage;

  #allRoutes = [];

  #allYears = [];
  #allMonths = [];
  #allWeeks = [];

  constructor(dateSelectors, groups, map) {
    this.#dateSelectors = dateSelectors;
    this.#groups = groups;
    this.#map = map;
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

  remove(routesToRemove) {
    let removedRoutes = [];

    for (let i = 0; i < routesToRemove.length; i++) {
      let route = routesToRemove[i];
      this.#allRoutes = this.#allRoutes.filter(item => item !== route);
      this.#groups.removeRouteFromAllGroups(route);
      this.#storage.removeRoute(route);
      this.#map.removeRoute(route);

      removedRoutes.push(route);
    }

    return removedRoutes;
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


class Controller {
  #dateSelectors;
  #fileParser;
  #groupSelector;
  #help;
  #map;
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
    this.#fileParser.parseDroppedFiles(files);
  }

  constructor(dateSelectors, fileParser, help, groupSelector, map, routeInfo, selectedRoutes) {
    this.#dateSelectors = dateSelectors;
    this.#fileParser = fileParser;
    this.#groupSelector = groupSelector;
    this.#help = help;
    this.#map = map;
    this.#routeInfo = routeInfo;
    this.#selectedRoutes = selectedRoutes;

    let mapDiv = map.getDiv();
    mapDiv.addEventListener("dragover", this.#ignoreDefaults.bind(this));
    mapDiv.addEventListener("dragenter", this.#ignoreDefaults.bind(this));
    mapDiv.addEventListener("dragleave", this.#ignoreDefaults.bind(this));
    mapDiv.addEventListener("drop", this.#filesDropped.bind(this));
    mapDiv.addEventListener("keydown", this.#mapKeyPress.bind(this));
    mapDiv.addEventListener("keyup", this.#mapKeyRelease.bind(this));

    document.body.addEventListener("keydown", this.#mapKeyPress.bind(this));
    document.body.addEventListener("keyup", this.#mapKeyRelease.bind(this));

    window.onblur = () => map.shrinkRoutes();
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

  constructor(groups, selectedRoutes, snackBar) {
    this.#groups = groups;
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

  constructor() {
    this.#container = document.querySelector("#snackbarDiv");
  }

  showErrorMsg(text) {
    this.#container.MaterialSnackbar.showSnackbar({
      message: text,
      timeout: 3000
    });
  }

  showUndoRouteDelete(plural, undoHandler) {
    this.#showUndoDelete(plural ? "Routes were deleted" : "Route was deleted", undoHandler);
  }

  showUndoGroupDelete(undoHandler) {
    this.#showUndoDelete("Group was deleted", undoHandler);
  }

  #showUndoDelete(message, undoHandler) {
    this.#container.MaterialSnackbar.showSnackbar({
      message: message,
      timeout: 5000,
      actionText: "Undo",
      actionHandler: async event => {
        undoHandler(event);
        this.#container.MaterialSnackbar.cleanup_();
      }
    });
  }  
}


class SelectedRoutes {
  #dateSelectors;
  #groups;
  #map;
  #routeInfo;
  #routes;
  #snackBar;

  #allSelectedRoutes = [];
  #selectedRoutesLength = 0;

  constructor(dateSelectors, routeInfo, snackBar) {
    this.#dateSelectors = dateSelectors;
    this.#routeInfo = routeInfo;
    this.#snackBar = snackBar;
  }

  setMap(map) {
    this.#map = map;
  }

  setGroups(groups) {
    this.#groups = groups;
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
    if (clearDate) {
      this.#dateSelectors.clear();
    }
  }

  set(routes) {
    this.clear(false);
    this.#allSelectedRoutes = routes;
    this.#updateSelectedRoutesLength();
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
    this.#map.updateRouteApperance(route, "selected");
    this.#updateSelectedRoutesLength();
    this.#routeInfo.update(null);
  }

  remove(route) {
    if (!this.#allSelectedRoutes.includes(route)) return;

    this.#allSelectedRoutes = this.#allSelectedRoutes.filter(item => item !== route);
    route.selected = false;
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
    let routeGroups = {};
    for (const route of this.#allSelectedRoutes) {
      routeGroups[route.id] = this.#groups.findRouteGroups(route);
    }

    let deletedRoutes = this.#routes.remove(this.#allSelectedRoutes);

    this.#allSelectedRoutes = [];
    this.#updateSelectedRoutesLength();
    this.#routeInfo.clear();
    this.#routes.rebuildDateOverview();
    this.#dateSelectors.update();

    this.#snackBar.showUndoRouteDelete(deletedRoutes.length > 1, async (event) => {
      this.#routes.addRoutes(deletedRoutes);

      for (const route of deletedRoutes) {
        let groups = routeGroups[route.id];
        for (const group of groups) {
          this.#groups.addRoutesToGroup(group, [route]);
        }
      }

      deletedRoutes = [];
    });
  }
}


class Groups {
  #selectedRoutes;
  #snackBar;
  #storage;

  #allGroups = [];

  constructor(selectedRoutes, snackBar) {
    this.#selectedRoutes = selectedRoutes;
    this.#snackBar = snackBar;
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
      routes: []
    };

    this.#allGroups.push(group);
    this.#storage.addGroup(group, callback);
  }

  remove(id) {
    let group = this.#findGroup(id);
    this.#allGroups = this.#allGroups.filter(item => item !== group);
    this.#storage.removeGroup(group);
    this.#selectedRoutes.clear();

    this.#snackBar.showUndoGroupDelete(async event => {
      this.#allGroups.push(group);
      this.#storage.addGroup(group, function() {});
    });
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

    this.#mapDiv = document.getElementById("mapDiv");

    this.#mapRef = L.map('mapDiv').setView({
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

  removeRoute(route) {
    let drawnRoute = this.#findDrawnRoute(route);
    drawnRoute.path.remove();
    this.#drawnRoutes = this.#drawnRoutes.filter(item => item !== drawnRoute);
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
  }

  #changeRouteWidth(diff) {
    this.#routeStyles["default"].weight += diff;
    this.#routeStyles["selected"].weight += diff;
    this.#routeStyles["hovered"].weight += diff;

    for (let i = 0; i < this.#drawnRoutes.length; i++) {
      this.#updateDrawnRouteApperance(this.#drawnRoutes[i], this.#drawnRoutes[i].appearence);
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
  #dateSelectors;
  #groups;
  #routes;

  #db = null;

  constructor(routes, groups, dateSelectors) {
    this.#routes = routes;
    this.#groups = groups;
    this.#dateSelectors = dateSelectors;
  }

  load() {
    let openRequest = indexedDB.open("routeDB", 2);

    openRequest.onupgradeneeded = event => {
      this.#db = event.target.result; 
      if (!this.#db.objectStoreNames.contains('routes')) {  
        let objectStore = this.#db.createObjectStore('routes', { keyPath: 'id', autoIncrement: true});
        objectStore.createIndex("hash", "hash", {unique: true});
      }

      if (!this.#db.objectStoreNames.contains('groups')) {  
        let objectStore = this.#db.createObjectStore('groups', { keyPath: 'id', autoIncrement: true});
      }
    }

    openRequest.onerror = () => { 
      console.error("Unable to access database", openRequest.error); 
    };
      
    openRequest.onsuccess = (event) => { 
      this.#db = event.target.result; 
      let readTransaction = this.#db.transaction("routes");
      let objectStore = readTransaction.objectStore("routes");
      objectStore.openCursor().onsuccess = (event) => {
        let cursor = event.target.result;
        if (cursor) {
          let route = cursor.value;
          route.selected = false;
          route.visible = true;
          this.#routes.addToDateOverview(route);
          this.#routes.push(route);
          cursor.continue();
        }
      }

      readTransaction.oncomplete = event => {
        if (this.#routes.count() > 0) {
          this.#dateSelectors.update();
        }

        // Groups must be loaded after routes
        this.#loadRoutes();
      }
    }
  }

  #loadRoutes() {
    let readTransaction = this.#db.transaction("groups");
    let objectStore = readTransaction.objectStore("groups");
    objectStore.openCursor().onsuccess = (event) => {
      let cursor = event.target.result;
      if (cursor) {
        let dbGroup = cursor.value;
        this.#groups.push({
          name: dbGroup.name,
          routes: this.#routes.findRoutesByIDs(dbGroup.routeIds),
          id: dbGroup.id
        })

        cursor.continue();
      }
    }
  }

  async addGroup(group, callback) {
    let dbGroup = {
      name: group.name,
      routeIds: group.routes.map(route => route.id)
    }

    let transaction = this.#db.transaction(["groups"], "readwrite");

    transaction.onerror = function(event)  { 
      console.error("Unable to access database", event); 
    };

    let objectStore = transaction.objectStore("groups");
    let request = objectStore.add(dbGroup);
    request.onsuccess = async function(event) {
      group.id = event.target.result;
      callback();
    };
  }

  async updateGroup(group) {
    let dbGroup = {
      name: group.name,
      routeIds: group.routes.map(route => route.id),
      id: group.id
    }

    let transaction = this.#db.transaction(["groups"], "readwrite");

    transaction.onerror = function(event)  { 
      console.error("Unable to access database", event); 
    };

    let objectStore = transaction.objectStore("groups");
    let request = objectStore.put(dbGroup);
    request.onsuccess = async function(event) {
      
    };
  }

  async removeGroup(group) {
    let transaction = this.#db.transaction(["groups"], "readwrite");

    transaction.onerror = function(event)  { 
      console.error("Unable to access database", event); 
    };

    let objectStore = transaction.objectStore("groups");
    let request = objectStore.delete(group.id);
    request.onsuccess = function(event) {

    }
  }

  async removeRoute(route) {
    let transaction = this.#db.transaction(["routes"], "readwrite");

    transaction.onerror = function(event)  { 
      console.error("Unable to access database", event); 
    };

    let objectStore = transaction.objectStore("routes");
    let request = objectStore.delete(route.id);
    request.onsuccess = function(event) {

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

  #getRouteId(route) {
    return this.lookupRoute(route, function(getter, resolve) {
      resolve(getter.result.id);
    });
  }

  async addRoute(route) {
    let dbRoute = {
      name: route.name,
      length: route.length,
      points: route.points,
      startTime: route.startTime,
      endTime: route.endTime,
      hash: route.hash
    }

    let transaction = this.#db.transaction(["routes"], "readwrite");

    transaction.onerror = function(event)  { 
      console.error("Unable to access database", event); 
    };

    let objectStore = transaction.objectStore("routes");
    let request = objectStore.add(dbRoute);
    request.onsuccess = async event => {
      route.id = await this.#getRouteId(route);
    };
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

