/******** Global route variables ***********/
var routes = [];
var selectedRoutes = [];
var selectedRoutesLength = 0;

var allYears = [];
var allMonths = [];
var allWeeks = [];

var routesHidden = false;


/******** Global group variables ***********/
var groups = [];

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

      var startTime;
      var endTime;
      var points = [];
      var trkpts = segment.getElementsByTagName("trkpt");
      for (var k = 0; k < trkpts.length; k++) {
        var trkpt = trkpts[k];
        var firstPoint = (k == 0);
        var lastPoint = (k == trkpts.length - 1);

        var lat = parseFloat(trkpt.getAttribute("lat"));
        var lon = parseFloat(trkpt.getAttribute("lon"));
        var point = {
          lat: lat, lng: lon
        };
        points.push(point);

        var timeTags = trkpt.getElementsByTagName("time");
        if (timeTags.length > 0) {
          var time = new Date(timeTags[0].textContent);
          if (firstPoint) {
            startTime = time;
          } else if (lastPoint) {
            endTime = time;
          }
        }
      }

      var newRoute = {
        name: name,
        points: points,
        length: routeLength(points),
        startTime: startTime,
        endTime: endTime,
        hash: await routeHash(points),
        visible: true,
        selected: false
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

function addToSetArray(array, item) {
  if (array.indexOf(item) === -1) {
    array.push(item);
  }
}

function addToDateOverview(route) {
  if (!route.startTime) return;

  addToSetArray(allYears, route.startTime.getFullYear());
  addToSetArray(allMonths, route.startTime.getMonth());
  addToSetArray(allWeeks, route.startTime.getWeek());
}

function rebuildDateOverview() {
  allYears = [];
  allMonths = [];
  allWeeks = [];

  for (var i = 0; i < routes.length; i++) {
    addToDateOverview(routes[i]);
  }
}


/******** User input ***********/
function mapKeyPress(event) {
  var key = event.keyCode || event.charCode;
  var keyHandled = true;

  if (helpShown) {
    if (key == 27) { // esc key
      hideHelp();
    }
  } else if (groupSelectShown) {
    if (key == 27) { // esc key
      hideGroupSelector();
    } else if (event.target != newGroupName) {
      if (key == 71 || key == 65 || key == 82) { // 'g', 'a', or 'r' key
        hideGroupSelector();
      }
    } else {
      keyHandled = false;
    }
  } else {
    if (key == 46) { // delete key
      deleteSelectedRoutes();
    } else if (key == 84) { // 't' key
      toggleTrails();
    } else if (key == 27) { // esc key
      clearSelectedRoutes();
    } else if (key == 72) { // 'h' key
      toggleHiddenSelectedRoutes();
    } else if (key == 68) { // 'd' key
      toggleDateSelectors();
    } else if (key == 65) { // 'a' key
      selectGroupToExtend();
    } else if (key == 82) { // 'r' key
      selectGroupToRemove();
    } else if (key == 71) { // 'g' key
      selectGroupToFocus();
    } else if (key == 18) { // alt key
      enlargeRoutes();
    } else {
      keyHandled = false;
    }  
  }

  if (key == 17) { // ctrl key
    ctrlDown = true;
  } else if (key == 191) { // '?' key
    toggleHelp();
  }

  if (keyHandled) {
    ignoreDefaults(event);
  }
}

function mapKeyRelease(event) {
  var key = event.keyCode || event.charCode;
  if (key == 17) { // ctrl key
    ctrlDown = false;
    removeSelectionBox(false);
  } else if (key == 18) { // alt key
    shrinkRoutes();
  }
}

function newGroupKeyUp(event) {
  var key = event.keyCode || event.charCode;
  if (key == 13) {
    if (newGroupName.value.length > 0) {
      createGroup(newGroupName.value, function() {
        updateGroupSelector(groupSelectorCallback);
      });
    }
  }
}

/******** UI code ***********/
var dateSelectors, yearSelector, monthSelector, weekSelector;
var helpBtn, helpDialog, closeHelpBtn, groupDialog, closeGroupBtn, groupList;
var newGroupName, groupSelectorTitle, newGroupContainer, errorMsgDiv;
var helpShown = false, groupSelectShown = false;

function hideHelp() {
  helpDialog.close();
  helpShown = false;
}

function showHelp() {
  helpDialog.showModal();
  helpShown = true;
}

function toggleHelp() {
  if (helpShown) {
    hideHelp();
  } else {
    showHelp();
  }
}

var groupSelectorCallback = null;
var groupSelectorGroups = null;
var groupSelectorDelete = false;

function groupSelectorClick(id) {
  hideGroupSelector();
  if (groupSelectorCallback) {
    groupSelectorCallback(id);
  }
}

function groupDeletorClick(id) {
  hideGroupSelector();
  deleteGroup(id);
}

function updateGroupSelector() {
  var groupListItems = "";
  for (var i = 0; i < groupSelectorGroups.length; i++) {
    var group = groupSelectorGroups[i];
    groupListItems += '<div class="groupListItem mdl-list__item"> \
        <span class="mdl-list__item-primary-content" onclick="groupSelectorClick(' + group.id + ')"> \
          <span>' + group.name + '</span> \
        </span>';
    if (groupSelectorDelete) {
      groupListItems += '<a class="mdl-list__item-secondary-action" onclick="groupDeletorClick(' + group.id + ')"><i class="material-icons">delete</i></a>';
    }
    groupListItems += '</div>';
  }

  newGroupName.value = "";
  newGroupName.parentElement.MaterialTextfield.change();
  closeGroupBtn.focus();

  groupList.innerHTML = groupListItems;
}

function showGroupSelector(callback, title, groups, newGroupInput, removeOption) {
  groupSelectorCallback = callback;
  groupSelectorGroups = groups;
  groupSelectorDelete = removeOption;

  updateGroupSelector();

  groupSelectorTitle.innerText = title;
  newGroupContainer.style.display = (newGroupInput ? "inline-block" : "none");

  groupDialog.showModal();
  closeGroupBtn.focus();
  groupSelectShown = true;
}

function hideGroupSelector() {
  groupDialog.close();
  groupSelectShown = false;
}

function addOptionToSelect(select, text, value) {
  var option = document.createElement("option");
  option.text = text;
  option.value = value;
  select.add(option);
}

function removeOptionsFromSelect(select) {
  for (var i = select.options.length - 1; i >= 0; i--) {
    select.remove(i);
  }
}

function selectHasOption(select, option) {
  for (var i = select.options.length - 1; i >= 0; i--) {
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
  for (var i = 0; i < array.length; i++) {
    addOptionToSelect(select, textGenerator(array[i]), array[i]);
  }
}

function clearDateSelectors() {
  yearSelector.value = "null";
  monthSelector.value = "null";
  weekSelector.value = "null";
}

function getDateSelectorValues() {
  return {
    year: yearSelector.value == "null" || yearSelector.value == "" ? null : parseInt(yearSelector.value),
    month: monthSelector.value == "null" || monthSelector.value == "" ? null : parseInt(monthSelector.value),
    week: weekSelector.value == "null" || weekSelector.value == "" ? null : parseInt(weekSelector.value)
  }
}

function updateDateSelectors(clearMonth, clearWeek) {
  var selectedDate = getDateSelectorValues();
  var dateOptions = getDateOptionsByYMW(selectedDate.year, selectedDate.month, selectedDate.week)

  removeOptionsFromSelect(yearSelector);
  removeOptionsFromSelect(monthSelector);
  removeOptionsFromSelect(weekSelector);


  var monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  addArrayToSelect(dateOptions.years, yearSelector, function(year) { return year; });
  addArrayToSelect(dateOptions.months, monthSelector, function(month) { return monthNames[month]; });
  addArrayToSelect(dateOptions.weeks, weekSelector, function(week) { return week; });

  setSelectOptionIfPossible(yearSelector, selectedDate.year);
  setSelectOptionIfPossible(monthSelector, selectedDate.month);
  setSelectOptionIfPossible(weekSelector, selectedDate.week);
}

function dateSelectorsChanged(clearMonth, clearWeek) {
  if (clearMonth) monthSelector.value = "null";
  if (clearWeek) weekSelector.value = "null";

  var selectedDate = getDateSelectorValues();
  selectRoutesByYMW(selectedDate.year, selectedDate.month, selectedDate.week);
  updateDateSelectors();
}

function toggleDateSelectors() {
  dateSelectors.hidden = !dateSelectors.hidden;
}

function initUI() {
  helpBtn = document.querySelector("#helpBtn");
  helpDialog = document.querySelector("#helpDialog");
  groupDialog = document.querySelector("#groupDialog");
  groupList = document.querySelector(".groupList");
  closeHelpBtn = document.querySelector("#closeHelpBtn");
  closeGroupBtn = document.querySelector("#closeGroupBtn");
  newGroupName = document.querySelector("#newGroupName");
  newGroupContainer = document.querySelector("#newGroupContainer");
  groupSelectorTitle = document.querySelector("#groupSelectorTitle");
  errorMsgDiv = document.querySelector("#errorMsgDiv");
  dateSelectors = document.querySelector("#dateSelectors");
  yearSelector = document.querySelector("#yearSelector");
  monthSelector = document.querySelector("#monthSelector");
  weekSelector = document.querySelector("#weekSelector");

  helpBtn.addEventListener('click', showHelp);
  closeHelpBtn.addEventListener('click', hideHelp);
  closeGroupBtn.addEventListener('click', hideGroupSelector);

  yearSelector.addEventListener('change', function() { dateSelectorsChanged(true, true) });
  monthSelector.addEventListener('change', function() { dateSelectorsChanged(false, true) });
  weekSelector.addEventListener('change', function() { dateSelectorsChanged(false, false) });

  newGroupName.addEventListener('keyup', newGroupKeyUp);

  window.onblur = shrinkRoutes;
}

function round(number) {
  return Math.round(number * 100) / 100;
}

function updateRouteInfo(route) {
  if (route != null) {
    routeInfoDiv.innerHTML = route.name + " - <b>" + round(route.length) + "</b> km";
  } else if (selectedRoutes.length == 1) {
    routeInfoDiv.innerHTML = selectedRoutes[0].name + " - <b>" + round(selectedRoutes[0].length) + "</b> km";
  } else {
    if (selectedRoutesLength > 0) {
      routeInfoDiv.innerHTML = "<b>" + round(selectedRoutesLength) + "</b> km";
    } else {
      clearRouteInfo();
      return;
    }
  }
  routeInfoDiv.style.display = "table-cell";
}

function clearRouteInfo() {
  if (selectedRoutes.length == 0) {
    routeInfoDiv.innerHTML = "";
    routeInfoDiv.style.display = "none";
  }
}

function showErrorMsg(text) {
  var container = document.querySelector("#snackbarDiv");
  container.MaterialSnackbar.showSnackbar({
    message: text,
    timeout: 3000
  });
}

function showUndoRouteDelete(plural, undoHandler) {
  showUndoDelete(plural ? "Routes were deleted" : "Route was deleted", undoHandler);
}

function showUndoGroupDelete(undoHandler) {
  showUndoDelete("Group was deleted", undoHandler);
}

function showUndoDelete(message, undoHandler) {
  var container = document.querySelector("#snackbarDiv");
  container.MaterialSnackbar.showSnackbar({
    message: message,
    timeout: 5000,
    actionText: "Undo",
    actionHandler: async function(event) {
      undoHandler(event);
      container.MaterialSnackbar.cleanup_();
    }
  });
}

/******** Control code ***********/
function clearSelectedRoutes(clearDate = true) {
  selectedRoutes.forEach(function (route) {
    route.selected = false;
    updatePathApperance(route, "default");
  });
  selectedRoutesLength = 0;
  selectedRoutes = [];
  clearRouteInfo();
  unhideAllRoutes();
  if (clearDate) {
    clearDateSelectors();
  }
}

function setSelectedRoutes(routes) {
  clearSelectedRoutes(false);
  selectedRoutes = routes;
  updateSelectedRoutesLength();
  for (var i = 0; i < routes.length; i++) {
    routes[i].selected = true;
    updatePathApperance(routes[i], "selected");
  }
  updateRouteInfo(null);
}

function addToSelectedRoutes(route) {
  if (selectedRoutes.includes(route)) return;

  selectedRoutes.push(route);
  route.selected = true;
  updatePathApperance(route, "selected");
  updateSelectedRoutesLength();
  updateRouteInfo(null);
}

function removeFromSelectedRoutes(route) {
  if (!selectedRoutes.includes(route)) return;

  selectedRoutes = selectedRoutes.filter(item => item !== route);
  route.selected = false;
  updatePathApperance(route, "hovered");
  updateSelectedRoutesLength();
  updateRouteInfo(route);
}

function selectRoutesByDateRange(fromDate, toDate) {
  var routesInDateRange = [];

  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    if ((fromDate == null || fromDate <= route.startTime) &&
        (toDate == null || toDate >= route.endTime)) {
      routesInDateRange.push(route);
    }
  }

  setSelectedRoutes(routesInDateRange);
}

function selectRoutesByYMW(year, month, week) {
  if (year == null && month == null && week == null) {
    clearSelectedRoutes();
    return;
  }

  var routesInDateRange = [];

  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];

    if ((route.startTime != null) && 
        (year == null || year == route.startTime.getFullYear()) &&
        (month == null || month == route.startTime.getMonth()) &&
        (week == null || week == route.startTime.getWeek())) {
      routesInDateRange.push(route);
    }
  }

  setSelectedRoutes(routesInDateRange);
  zoomToRoutes(routesInDateRange);
}

function getDateOptionsByYMW(year, month, week) {
  var filteredYears = [];
  var filteredMonths = [];
  var filteredWeeks = [];

  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];

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

function unhideAllRoutes() {
  if (!routesHidden) return;
  
  routes.forEach(function(route) { 
    if (!route.visible) {
      route.visible = true;
      route.path.addTo(map);
    }
  });

  selectedRoutes.forEach(function(route) {
    route.path.bringToFront();
  });

  routesHidden = false;
}

function hideOtherRoutes(visibleRoutes) {
  if (routesHidden) return;

  var nonSelectedRoutes = routes.filter(route => !visibleRoutes.includes(route));
  nonSelectedRoutes.forEach(function(route) {
    route.visible = false;
    route.path.remove()
  });

  routesHidden = true;
}

function toggleHiddenSelectedRoutes() {
  if (routesHidden) {
    unhideAllRoutes();
  } else {
    if (selectedRoutes.length > 0) {
      hideOtherRoutes(selectedRoutes);
    }
  }
}

function selectRoutesInBounds(startLat, startLng, endLat, endLng) {
  var minLat = Math.min(startLat, endLat);
  var maxLat = Math.max(startLat, endLat);
  var minLng = Math.min(startLng, endLng);
  var maxLng = Math.max(startLng, endLng);

  for (var i = 0; i < routes.length; i++) {
    var curRoute = routes[i];

    if (!curRoute.visible) {
      continue;
    }

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

function selectGroupToFocus() {
  showGroupSelector(focusGroup, "Select Group", groups, true, true);
}

function selectGroupToExtend() {
  if (selectedRoutes.length > 0) {
    if (groups.length > 0) {
      showGroupSelector(addSelectedRoutesToGroup, "Add to Group", groups, false, false);
    } else {
      showErrorMsg("Create a group first by pressing 'g'");
    }
  } else {
    showErrorMsg("Select routes to add them to a group");
  }
}

function selectGroupToRemove() {
  if (selectedRoutes.length > 0) {
    var selectedRoutesGroups = findRoutesGroups(selectedRoutes);
    if (selectedRoutesGroups.length > 0) {
      showGroupSelector(removeSelectedRoutesFromGroup, "Remove from Group", selectedRoutesGroups, false, false);
    } else {
      showErrorMsg("The selected routes does not belong to any groups");
    }
  }
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
      addToDateOverview(route);
      addRouteToDb(route);
    }
  }

  routes = routes.concat(newRoutes);

  updateDateSelectors();

  return newRoutes;
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
  rebuildDateOverview();
  updateDateSelectors();

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

function findRoutesByIDs(routeIds) {
  var routeIdHash = {};
  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    routeIdHash[route.id] = route;
  }

  var foundRoutes = [];
  for (var i = 0; i < routeIds.length; i++) {
    var routeId = routeIds[i];
    if (routeIdHash.hasOwnProperty(routeId)) {
      foundRoutes.push(routeIdHash[routeId]);
    } else {
      console.log("Unknown route ID: " + routeId);
    }
  }

  return foundRoutes;
}

/******** Group functions ***********/
function createGroup(name, callback) {
  var group = {
    name: name,
    routes: []
  };

  groups.push(group);
  addGroupToDb(group, callback);
}

function deleteGroup(id) {
  var group = findGroup(id);
  groups = groups.filter(item => item !== group);
  removeGroupFromDb(group);

  showUndoGroupDelete(async function(event) {
    groups.push(group);
    addGroupToDb(group, function() {});
  });
}

function findGroup(id) {
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    if (group.id == id) {
      return group;
    }
  }
  throw "Unknown group ID " + id;
}

function addRoutesToGroup(id, routes) {
  var group = findGroup(id);

  for (var i = 0; i < routes.length; i++) {
    addToSetArray(group.routes, routes[i]);
  }

  updateGroupInDb(group);
}

function addSelectedRoutesToGroup(id) {
  addRoutesToGroup(id, selectedRoutes);
  focusGroup(id);
}

function removeRoutesFromGroup(id, routes) {
  var group = findGroup(id);

  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    group.routes = group.routes.filter(item => item !== route);
  }

  updateGroupInDb(group);
}

function removeSelectedRoutesFromGroup(id) {
  removeRoutesFromGroup(id, selectedRoutes);
  focusGroup(id);
}

function focusGroup(id) {
  var group = findGroup(id);
  setSelectedRoutes(group.routes);
}

function findRouteGroups(route) {
  var foundGroups = [];

  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    if (group.routes.includes(route)) {
      foundGroups.push(group);
    }
  }

  return foundGroups;
}

function findRoutesGroups(routes) {
  var foundGroups = [];

  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    var routeGroups = findRouteGroups(route);
    for (var j = 0; j < routeGroups.length; j++) {
      addToSetArray(foundGroups, routeGroups[j]);
    }
  }

  return foundGroups;
}

/******** Map functions ***********/
var map;
var hikingTrails;
var routesEnlarged = false;

var routeStyles = {
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
  if (routes == null || routes.length == 0) return;

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

  document.body.addEventListener("keydown", mapKeyPress);
  document.body.addEventListener("keyup", mapKeyRelease);

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
  initUI();
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
  route.appearence = appearence;

  route.path.setStyle(routeStyles[appearence]);
  if (appearence == "default") {
    route.path.bringToBack();
  } else {
    route.path.bringToFront();
  }
}

function enlargeRoutes() {
  if (routesEnlarged) return;
  changeRouteWidth(2);
  routesEnlarged = true;
}

function shrinkRoutes() {
  if (!routesEnlarged) return;
  changeRouteWidth(-2);
  routesEnlarged = false;
}

function changeRouteWidth(diff) {
  routeStyles["default"].weight += diff;
  routeStyles["selected"].weight += diff;
  routeStyles["hovered"].weight += diff;

  for (var i = 0; i < routes.length; i++) {
    updatePathApperance(routes[i], routes[i].appearence);
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


/******** Route and group storage ***********/
var db;

function initDb() {
  var openRequest = indexedDB.open("routeDB", 2);

  openRequest.onupgradeneeded = function(event) {
    db = event.target.result; 
    if (!db.objectStoreNames.contains('routes')) {  
      var objectStore = db.createObjectStore('routes', { keyPath: 'id', autoIncrement: true});
      objectStore.createIndex("hash", "hash", {unique: true});
    }

    if (!db.objectStoreNames.contains('groups')) {  
      var objectStore = db.createObjectStore('groups', { keyPath: 'id', autoIncrement: true});
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
        route.selected = false;
        route.visible = true;
        drawRoute(route);
        addToDateOverview(route);
        routes.push(route);
        cursor.continue();
      }
    }

    readTransaction.oncomplete = function(event) {
      if (routes.length > 0) {
        updateDateSelectors();
      }

      // Groups must be loaded after routes
      loadRoutes();
    }
  };
}

function loadRoutes() {
  let readTransaction = db.transaction("groups");
  let objectStore = readTransaction.objectStore("groups");
  objectStore.openCursor().onsuccess = function(event) {
    var cursor = event.target.result;
    if (cursor) {
      var dbGroup = cursor.value;
      groups.push({
        name: dbGroup.name,
        routes: findRoutesByIDs(dbGroup.routeIds),
        id: dbGroup.id
      })

      cursor.continue();
    }
  }
}

function lookupGroup(group, callback) {
  var transaction = db.transaction(["groups"], "readwrite");
  var objectStore = transaction.objectStore("groups");

  return new Promise((resolve, reject) => {
    var getter = objectStore.get(group.id);

    getter.onsuccess = function(event) {
      callback(getter, resolve);
    }

    getter.onerror = function(event) {
      console.log("Unable to access database", event);
      reject();
    }
  });
}

function groupExists(route) {
  return lookupGroup(group, function(getter, resolve) {
    resolve(getter.result);
    if (!getter.result) {
      resolve(false);
    } else {
      resolve(true);
    }
  });
}

async function addGroupToDb(group, callback) {
  var dbGroup = {
    name: group.name,
    routeIds: group.routes.map(route => route.id)
  }

  var transaction = db.transaction(["groups"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("groups");
  var request = objectStore.add(dbGroup);
  request.onsuccess = async function(event) {
    group.id = event.target.result;
    callback();
  };
}

async function updateGroupInDb(group) {
  var dbGroup = {
    name: group.name,
    routeIds: group.routes.map(route => route.id),
    id: group.id
  }

  var transaction = db.transaction(["groups"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("groups");
  var request = objectStore.put(dbGroup);
  request.onsuccess = async function(event) {
    
  };
}

async function removeGroupFromDb(group) {
  var transaction = db.transaction(["groups"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("groups");
  var request = objectStore.delete(group.id);
  request.onsuccess = function(event) {

  }
}

async function removeRouteFromDb(route) {
  var transaction = db.transaction(["routes"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("routes");
  var request = objectStore.delete(route.id);
  request.onsuccess = function(event) {

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
  var dbRoute = {
    name: route.name,
    length: route.length,
    points: route.points,
    startTime: route.startTime,
    endTime: route.endTime,
    hash: route.hash
  }

  var transaction = db.transaction(["routes"], "readwrite");

  transaction.onerror = function(event)  { 
    console.error("Unable to access database", event); 
  };

  var objectStore = transaction.objectStore("routes");
  var request = objectStore.add(dbRoute);
  request.onsuccess = async function(event) {
    route.id = await getRouteId(route);
  };
}

/******** Utils ***********/
// Source: https://weeknumber.com/how-to/javascript
// Returns the ISO week of the date.
Date.prototype.getWeek = function() {
  var date = new Date(this.getTime());
  date.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  // January 4 is always in week 1.
  var week1 = new Date(date.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and count number of weeks from date to week1.
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000
                        - 3 + (week1.getDay() + 6) % 7) / 7);
}
