let map = L.map('map').setView([28.6139, 77.2090], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let marker = L.marker([28.6139, 77.2090]).addTo(map);

function updateMap(lat, lon, city) {

    map.setView([lat, lon], 10);

    marker.setLatLng([lat, lon]);

    marker.bindPopup(city).openPopup();

}