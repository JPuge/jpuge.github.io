var map;

function parseRoutes(gpx) {
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

      routes.push({
        name: name,
        points: points 
      })
    }
  }

  return routes;
}

function drawRoute(route, map) {
  var path = new google.maps.Polyline({
    path: route.points,
    geodesic: true,
    strokeColor: "#0000CC",
    strokeOpacity: 1.0,
    strokeWeight: 2,
  });
  path.setMap(map);
}

function parseDroppedFile(file, doneHandler) {
  var reader = new FileReader();
  reader.onload = function(e) { 
    var routes = plotGpxFile(e.target.result, map);
    doneHandler(routes);
  }
  reader.readAsText(file);
}

function parseDroppedFiles(e) {
  e.stopPropagation();
  e.preventDefault();

  var files = e.target.files || e.dataTransfer.files;

  // process all File objects
  var routes = [];
  for (var i = 0; i < files.length; i++) {
    parseDroppedFile(files[i], function(addedRoutes) {
      routes = routes.concat(addedRoutes);

      if (i >= files.length - 1) {
        map.setCenter(routesCenter(routes)); 
      }
    });
  }
}

function ignoreDefaults(e) {
  e.stopPropagation();
  e.preventDefault();
}

function plotGpxFile(gpxRoute, map) {
  var routes = parseRoutes(gpxRoute);
  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    drawRoute(route, map);
  }

  return routes;
}

function routesCenter(routes) {
  var lat = {min: routes[0].points[0].lat, max: routes[0].points[0].lat};
  var lng = {min: routes[0].points[0].lng, max: routes[0].points[0].lng};

  for (var i = 0; i < routes.length; i++) {
    for (var j = 0; j < routes[i].points.length; j++) {
      var point = routes[i].points[j];
      lat.min = Math.min(lat.min, point.lat);
      lat.min = Math.max(lat.min, point.lat);
      lng.min = Math.min(lng.min, point.lng);
      lng.min = Math.max(lng.min, point.lng);
    }
  }

  return {
    lat: (lat.max - lat.min) / 2 + lat.min  ,
    lng: (lng.max - lng.min) / 2 + lng.min  
  }
}

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 9,
    center: { lat: 0, lng: -180 },
    mapTypeId: "terrain",
  });

  routes = plotGpxFile(gpxRoute, map);
  map.setCenter(routesCenter(routes));

  document.getElementById("map").addEventListener("dragover", ignoreDefaults);
  document.getElementById("map").addEventListener("dragenter", ignoreDefaults);
  document.getElementById("map").addEventListener("dragleave", ignoreDefaults);
  document.getElementById("map").addEventListener("drop", parseDroppedFiles);
}