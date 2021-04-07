/******** Global route variables ***********/
var routes;
var selectedRoutes = [];
var selectedRoutesLength = 0;

/******** Global UI variables ***********/
var routeInfoDiv;
var mapDiv;

var ctrlDown = false;

/******** GPX file and route parsing ***********/
async function parseRoutes(gpx) {
  var routes = [];

  var parser = new DOMParser();
  gpxDOM = parser.parseFromString(gpx, "text/xml");

  var tracks = gpxDOM.getElementsByTagName("trk");
  for (var i = 0; i < tracks.length; i++) {
    var track = tracks[i];

    var name = "";
    var nameTag = track.getElementsByTagName("name")[0];
    if (nameTag) {
      name = nameTag.textContent;
    }

    var segments = track.getElementsByTagName("trkseg");
    for (var j = 0; j < segments.length; j++) {
      var segment = segments[j];

      var points = [];
      var trkpts = segment.getElementsByTagName("trkpt");
      for (var k = 0; k < trkpts.length; k++) {
        var trkpt = trkpts[k];
        var lat = parseFloat(trkpt.getAttribute("lat"));
        var lon = parseFloat(trkpt.getAttribute("lon"));
        var point = {
          lat: lat, lng: lon
        };
        points.push(point);
      }

      var newRoute = {
        name: name,
        points: points,
        length: routeLength(points),
        hash: await routeHash(points)
      };

      routes.push(newRoute);
    }
  }

  return routes;
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function distanceInKmBetweenPoints(point1, point2) {
  var earthRadiusKm = 6371;

  var dLat = degreesToRadians(point2.lat-point1.lat);
  var dLng = degreesToRadians(point2.lng-point1.lng);

  var dLat1 = degreesToRadians(point1.lat);
  var dLat2 = degreesToRadians(point2.lat);

  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(dLat1) * Math.cos(dLat2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return earthRadiusKm * c;
}

function routeLength(points) {
  var length = 0;

  var prevPoint = points[0];

  for (var i = 1; i < points.length; i++) {
    length += distanceInKmBetweenPoints(prevPoint, points[i]);
    prevPoint = points[i];
  }

  return length;
}

function routesCenter(routes) {
  var latSum = 0;
  var lngSum = 0;
  var pointCount = 0;

  for (var i = 0; i < routes.length; i++) {
    for (var j = 0; j < routes[i].points.length; j++) {
      var point = routes[i].points[j];
      latSum += point.lat;
      lngSum += point.lng;
      pointCount += 1;
    }
  }

  return {
    lat: latSum / pointCount,
    lng: lngSum / pointCount
  }
}

async function routeHash(points) {
  var pointMsg = points.map(point => point.lat + point.lng).toString();

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

/******** UI code ***********/
function round(number) {
  return Math.round(number * 100) / 100;
}

function updateRouteInfo(route) {
  if (route != null) {
    routeInfoDiv.innerHTML = route.name + " - <b>" + round(route.length) + "</b> km";
  } else if (selectedRoutes.length == 1) {
    routeInfoDiv.innerHTML = selectedRoutes[0].name + " - <b>" + round(selectedRoutes[0].length) + "</b> km";
  } else {
    routeInfoDiv.innerHTML = "<b>" + round(selectedRoutesLength) + "</b> km";
  }
  routeInfoDiv.style.display = "table-cell";
}

function clearRouteInfo() {
  if (selectedRoutes.length == 0) {
    routeInfoDiv.innerHTML = "";
    routeInfoDiv.style.display = "none";
  }
}

function showUndoRouteDelete(plural, undoHandler) {
  var container = document.querySelector("#deleteUndoDiv");
  container.MaterialSnackbar.showSnackbar({
    message: plural ? "Routes were deleted" : "Route was deleted",
    timeout: 5000,
    actionText: "Undo",
    actionHandler: async function(event) {
      undoHandler(event);
      container.MaterialSnackbar.cleanup_();
    }
  });
}

/******** Control code ***********/
function clearSelectedRoutes() {
  selectedRoutes.forEach(route => updatePathApperance(route, "default"));
  selectedRoutesLength = 0;
  selectedRoutes = [];
  clearRouteInfo();
}

function setSelectedRoutes(routes) {
  clearSelectedRoutes();
  selectedRoutes = routes;
  updateSelectedRoutesLength();
  for (var i = 0; i < routes.length; i++) {
    updatePathApperance(routes[i], "selected");
  }
  updateRouteInfo(null);
}

function addToSelectedRoutes(route) {
  if (selectedRoutes.includes(route)) return;

  selectedRoutes.push(route)
  updatePathApperance(route, "selected");
  updateSelectedRoutesLength();
  updateRouteInfo(null);
}

function removeFromSelectedRoutes(route) {
  if (!selectedRoutes.includes(route)) return;

  selectedRoutes = selectedRoutes.filter(item => item !== route);
  updatePathApperance(route, "hovered");
  updateSelectedRoutesLength();
  updateRouteInfo(null);
}

function selectRoutesInBounds(startLat, startLng, endLat, endLng) {
  var minLat = Math.min(startLat, endLat);
  var maxLat = Math.max(startLat, endLat);
  var minLng = Math.min(startLng, endLng);
  var maxLng = Math.max(startLng, endLng);

  for (var i = 0; i < routes.length; i++) {
    var curRoute = routes[i];

    for (var j = 0; j < curRoute.points.length; j++) {
      var curPoint = curRoute.points[j];

      if (minLat < curPoint.lat && curPoint.lat < maxLat &&
          minLng < curPoint.lng && curPoint.lng < maxLng) {
        addToSelectedRoutes(curRoute);
        break;
      }
    }
  }
}

function updateSelectedRoutesLength() {
  selectedRoutesLength = selectedRoutes.reduce(function (prev, cur) {
    return prev + cur.length;
  }, 0);
}

function parseDroppedFile(file) {
  var reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = async function(e) { 
      var routes = await addGpxFile(e.target.result);
      resolve(routes);
    }
    reader.readAsText(file);
  });
}

function parseDroppedFiles(e) {
  e.stopPropagation();
  e.preventDefault();

  var files = e.target.files || e.dataTransfer.files;

  // process all File objects
  var promises = [];
  for (var i = 0; i < files.length; i++) {
    promises.push(parseDroppedFile(files[i]));
  }

  Promise.all(promises).then((routeFiles) => {
    var newRoutes = [];
    for (var i = 0; i < routeFiles.length; i++) {
      for (var j = 0; j < routeFiles[i].length; j++) {
        newRoutes = newRoutes.concat(routeFiles[i][j]);
      }
    }

    if (newRoutes.length != 0) {
      setSelectedRoutes(newRoutes);
      zoomToRoutes(newRoutes);
    }
  });
}

function ignoreDefaults(e) {
  e.stopPropagation();
  e.preventDefault();
}

async function addGpxFile(gpxRoute) {
  var fileRoutes = await parseRoutes(gpxRoute);
  return await addRoutes(fileRoutes);
}

async function addRoutes(addedRoutes) {
  var newRoutes = [];

  for (var i = 0; i < addedRoutes.length; i++) {
    var route = addedRoutes[i];
    if (await routeExists(route)) {
      console.log("Route already exists: " + route.name);
    } else {
      newRoutes.push(route);
      drawRoute(route);
      addRouteToDb(route);
    }
  }

  routes = routes.concat(newRoutes);

  return newRoutes;
}

function mapKeyPress(event) {
  var key = event.keyCode || event.charCode;
  if (key == 46) { // delete key
    deleteSelectedRoutes();
  } else if (key == 84) { // 't' key
    toggleTrails();
  } else if (key == 17) { // ctrl key
    ctrlDown = true;
  }
}

function mapKeyRelease(event) {
  var key = event.keyCode || event.charCode;
  if (key == 17) { // ctrl key
    ctrlDown = false;
    removeSelectionBox(false);
  }
}

function deleteSelectedRoutes() {
  var deletedRoutes = [];

  for (var i = 0; i < selectedRoutes.length; i++) {
    var route = selectedRoutes[i];
    routes = routes.filter(item => item !== route);
    removeRouteFromDb(route);
    removeRouteFromMap(route);

    deletedRoutes.push(route);
  }

  selectedRoutes = [];
  clearRouteInfo();

  showUndoRouteDelete(deletedRoutes.length > 1, async function(event) {
    addRoutes(deletedRoutes);
    deletedRoutes = [];

  });
}

function showCurrentPosition() {
  var locationFound = function(position) {
    var lat = position.coords.latitude;
    var lng = position.coords.longitude;
    zoomToPoint(lat, lng);
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(locationFound);
  }
}

/******** Map functions ***********/
var map;
var hikingTrails;

var routeStyles = {
  "default": {
    color: "#0000CC",
    weight: 3,
    opacity: 0.9,
    smothFactor: 1
  },
  "selected": {
    color: "#FFD90F",
    weight: 4,
    opacity: 0.9,
    smothFactor: 1
  },
  "hovered": {
    color: "#CC0000",
    weight: 4,
    opacity: 0.9,
    smothFactor: 1
  },
}

var selectionBox = null;
var selectionBoxStart;
var selectionBoxEnd;

var selectionBoxStyle = {
  color: "#6e8f5e",
  opacity: 0.7,
  weight: 3,
  fill: true,
  fillColor: "#6e8f5e",
  fillOpacity: 0.3 
}

function drawRoute(route) {
  var path = L.polyline(route.points);

  path.route = route;
  route.path = path;
  updatePathApperance(route, "default");
  path.addTo(map);

  path.on('mouseover', function(event) {
    updatePathApperance(route, "hovered");
    if (!selectedRoutes.includes(path.route)) {
      updateRouteInfo(path.route);
    }
  });

  path.on('mouseout', function(event) {
    if (selectedRoutes.includes(path.route)) {
      updatePathApperance(route, "selected");
    } else {
      updatePathApperance(route, "default");
      updateRouteInfo(null);
      clearRouteInfo();
    }
  });

  path.on('click', function(event) {
    if (!selectedRoutes.includes(path.route)) {
      addToSelectedRoutes(path.route);
    } else {
      removeFromSelectedRoutes(path.route);
    }
  });
}

function removeRouteFromMap(route) {
  route.path.remove();
}

function mapCenterRoutes(routes) {
  map.panTo(routesCenter(routes));
}

function zoomToRoutes(routes) {
  var bounds = routes[0].path.getBounds();
  for (var i = 1; i < routes.length; i++) {
    bounds.extend(routes[i].path.getBounds());
  }
  map.flyToBounds(bounds);
}

function zoomToPoint(lat, lng) {
  map.flyTo(L.latLng(lat, lng));
}

function initMap() {
  routes = [];

  mapDiv = document.getElementById("mapDiv");
  routeInfoDiv = document.getElementById("routeInfo");

  mapDiv.addEventListener("dragover", ignoreDefaults);
  mapDiv.addEventListener("dragenter", ignoreDefaults);
  mapDiv.addEventListener("dragleave", ignoreDefaults);
  mapDiv.addEventListener("drop", parseDroppedFiles);
  mapDiv.addEventListener("keydown", mapKeyPress);
  mapDiv.addEventListener("keyup", mapKeyRelease);

  map = L.map('mapDiv').setView({
    lat: 55.50841618187183,
    lng: 11.593322753906252
  }, 9);

  map.on('click', function(ev) { 
    if (selectionBox) {
      removeSelectionBox(true);
    } else { 
      createSelectionBox(ev.latlng); 
    }
  });
  map.on('mousemove', function(ev) { updateSelectionBox(ev.latlng); });

  var outdoorsTiles = L.tileLayer('https://{s}.tile.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey={apikey}', {
    attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    apikey: '962b25ed041c480ca12771e771a48828',
    maxZoom: 22
  }).addTo(map);

  routeInfoDiv.addEventListener("click", clearSelectedRoutes);

  initDb();
  showCurrentPosition();
}

function addTrails() {
  hikingTrails = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map style: &copy; <a href="https://waymarkedtrails.org">waymarkedtrails.org</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
  }).addTo(map);
}

function removeTrails() {
  if (hikingTrails) {
    hikingTrails.remove();
    hikingTrails = null;
  }
}

function toggleTrails() {
  if (hikingTrails) {
    removeTrails();
  } else {
    addTrails();
  }
}

function updatePathApperance(route, appearence) {
  route.path.setStyle(routeStyles[appearence]);
  if (appearence == "default") {
    route.path.bringToBack();
  } else {
    route.path.bringToFront();
  }
}

function createSelectionBox(startLatLng) {
  if (!ctrlDown) return;

  selectionBoxStart = startLatLng;
  var boxBounds = L.latLngBounds(selectionBoxStart, selectionBoxStart);
  selectionBox = L.rectangle(boxBounds, selectionBoxStyle).addTo(map);
}

function updateSelectionBox(newLatLng) {
  if (!selectionBox) return;

  selectionBoxEnd = newLatLng;
  selectionBox.setBounds(L.latLngBounds(selectionBoxStart, selectionBoxEnd));
}

function removeSelectionBox(addRoutes) {
  if (!selectionBox) return;

  if (addRoutes) {
    selectRoutesInBounds(selectionBoxStart.lat, selectionBoxStart.lng, 
                         selectionBoxEnd.lat, selectionBoxEnd.lng);
  }

  selectionBox.remove();
  selectionBox = null;
}

/*** Google maps 


var routeStyles = {
  "default": {
    geodesic: true,
    strokeColor: "#0000CC",
    strokeOpacity: 0.9,
    strokeWeight: 3.5,
    zIndex: 1
  },
    "selected": {
    geodesic: true,
    strokeColor: "#FFD90F",
    strokeOpacity: 0.9,
    strokeWeight: 4.5,
    zIndex: 10
  },
    "hovered": {
    geodesic: true,
    strokeColor: "#CC0000",
    strokeOpacity: 0.9,
    strokeWeight: 4.5,
    zIndex: 10
  }
};

function drawRoute(route) {
  var path = new google.maps.Polyline({
    ...routeStyles["default"],
    path: route.points
  });

  path.setMap(map);
  path.route = route;
  route.path = path;
  
  path.addListener('mouseover', function(event) {
    if (selectedRoutes.includes(path.route)) return;
    updatePathApperance("hovered");
    updateRouteInfo(path.route);
  });

  path.addListener('mouseout', function(event) {
    if (selectedRoutes.includes(path.route)) return;
    this.setOptions("default");
    clearRouteInfo();
  });

  path.addListener('click', function(event) {
    if (!selectedRoutes.includes(path.route)) {
      selectedRoutes.push(path.route)
      updatePathApperance("selected");
    } else {
      selectedRoutes = selectedRoutes.filter(item => item !== path.route);
      updatePathApperance("hovered");
    }

    selectedRoutesLength = selectedRoutes.reduce(function (prev, cur) {
      return prev + cur.length;
    }, 0);

    updateRouteInfo(path.route);
  });
}

function removeRouteFromMap(route) {
  route.path.setMap(null);
}

function mapCenterRoutes(routes) {
  map.setCenter(routesCenter(routes));
}

function initMap() {
  mapDiv = document.getElementById("mapDiv");
  routeInfoDiv = document.getElementById("routeInfo");

  map = new google.maps.Map(mapDiv, {
    zoom: 9,
    center: { lat: 0, lng: -180 },
    mapTypeId: "terrain",
  });

  routes = [];
  
  mapDiv.addEventListener("dragover", ignoreDefaults);
  mapDiv.addEventListener("dragenter", ignoreDefaults);
  mapDiv.addEventListener("dragleave", ignoreDefaults);
  mapDiv.addEventListener("drop", parseDroppedFiles);
  mapDiv.addEventListener("keydown", deleteSelectedRoutes);

  routeInfoDiv.addEventListener("click", clearSelectedRoutes);

  initDb();
}

function updatePathApperance(route, appearence) {
  route.path.setOptions(routeStyles[appearence]);
}
*/

/******** Route storage ***********/
var db;

function initDb() {
  var openRequest = indexedDB.open("routeDB", 1);

  openRequest.onupgradeneeded = function(event) {
    db = event.target.result; 
    if (!db.objectStoreNames.contains('routes')) {  
      var objectStore = db.createObjectStore('routes', { keyPath: 'id', autoIncrement: true});
      objectStore.createIndex("hash", "hash", {unique: true});
    }
  }

  openRequest.onerror = function()  { 
    console.error("Unable to access database", openRequest.error); 
  };
    
  openRequest.onsuccess = function(event) { 
    db = event.target.result; 
    let readTransaction = db.transaction("routes");
    let objectStore = readTransaction.objectStore("routes");
    objectStore.openCursor().onsuccess = function(event) {
      var cursor = event.target.result;
      if (cursor) {
        var route = cursor.value;
        drawRoute(route);
        routes.push(route);
        cursor.continue();
      }
    }

    readTransaction.oncomplete = function(event) {
      if (routes.length > 0) {
        // Maybe nothing?
      }
    }
  };
}

async function removeRouteFromDb(route) {
  var transaction = db.transaction(["routes"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("routes");
  var request = objectStore.delete(route.id);
  request.onsuccess = function(event) {
    console.log("Removed " + route.name);
  }
}

function lookupRoute(route, callback) {
  var transaction = db.transaction(["routes"], "readwrite");
  var objectStore = transaction.objectStore("routes");
  var hashIndex = objectStore.index('hash');

  return new Promise((resolve, reject) => {
    var getter = hashIndex.get(route.hash);

    getter.onsuccess = function(event) {
      callback(getter, resolve);
    }

    getter.onerror = function(event) {
      console.log("Unable to access database", event);
      reject();
    }
  });
}

function routeExists(route) {
  return lookupRoute(route, function(getter, resolve) {
    if (!getter.result) {
      resolve(false);
    } else {
      resolve(true);
    }
  });
}

function getRouteId(route) {
  return lookupRoute(route, function(getter, resolve) {
    resolve(getter.result.id);
  });
}

async function addRouteToDb(route) {
  if (!db) return;

  var dbRoute = {
    name: route.name,
    length: route.length,
    points: route.points,
    hash: route.hash
  }

  var transaction = db.transaction(["routes"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("routes");
  var request = objectStore.add(dbRoute);
  request.onsuccess = async function(event) {
    console.log("Added " + route.name);
    route.id = await getRouteId(route);
  };

}