const API_KEY = "40a1961c537478f871f4980425209858";
const BASE_URL = "https://api.openweathermap.org/data/2.5/weather";
const FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";
const cityInput = document.getElementById("cityInput");
const searchBtn = document.getElementById("searchBtn");
const locationBtn = document.getElementById("locationBtn");

function showError(message){

    const box = document.getElementById("errorBox");
    const text = document.getElementById("errorText");

    text.innerText = message;
    box.style.display = "flex";

    setTimeout(() => {
        box.style.display = "none";
    }, 3000);

}
async function getWeather(city) {

    const url = `${BASE_URL}?q=${city}&appid=${API_KEY}&units=metric`;
    document.getElementById("loader").style.display = "flex";

    try {

        const response = await fetch(url);
        const data = await response.json();

        if (data.cod != 200) {

    document.getElementById("loader").style.display = "none";

    showError("City not found. Please enter a valid city.");

    return;
}

        document.getElementById("cityName").innerText = data.name;
        document.getElementById("temperature").innerText =
            Math.round(data.main.temp) + "°C";

        document.getElementById("weatherCondition").innerText =
            data.weather[0].main;

            document.getElementById("weatherIcon").src =
`https://openweathermap.org/img/wn/${data.weather[0].icon}@4x.png`;

        document.getElementById("humidity").innerText =
            "Humidity : " + data.main.humidity + "%";

        document.getElementById("wind").innerText =
            "Wind : " + data.wind.speed + " km/h";

        document.getElementById("feelsLike").innerText =
            "Feels Like : " + Math.round(data.main.feels_like) + "°C";

            const sunrise = new Date(data.sys.sunrise * 1000);
const sunset = new Date(data.sys.sunset * 1000);

document.getElementById("sunrise").innerText =
    sunrise.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

document.getElementById("sunset").innerText =
    sunset.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    getForecast(city);

    const lat = data.coord.lat;
const lon = data.coord.lon;

getAQI(lat, lon);
updateMap(lat, lon, data.name);
document.getElementById("loader").style.display = "none";

    } catch (error) {
     document.getElementById("loader").style.display = "none";
    console.log(error);
    showError("Something went wrong. Please try again.");
   
}

    

}
async function getForecast(city) {

    const url = `${FORECAST_URL}?q=${city}&appid=${API_KEY}&units=metric`;

    const response = await fetch(url);
    const data = await response.json();

    const forecastContainer = document.getElementById("forecastContainer");

    forecastContainer.innerHTML = "";
    const labels = [];
const temps = [];

    const dailyData = data.list.filter(item =>
        item.dt_txt.includes("12:00:00")
    );

    dailyData.forEach(day => {

        const date = new Date(day.dt_txt);
        updateChart(labels, temps);

        const dayName = date.toLocaleDateString("en-US", {
            weekday: "short"
        });
        labels.push(dayName);
temps.push(Math.round(day.main.temp));

        forecastContainer.innerHTML += `
            <div class="forecast-card">
                <h3>${dayName}</h3>
                <img src="https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png">
                <p>${Math.round(day.main.temp)}°C</p>
            </div>
        `;

    });

}

async function getAQI(lat, lon) {

    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`;

    try {

        const response = await fetch(url);
        const data = await response.json();

        console.log(data);

        document.getElementById("aqiValue").innerText =
            data.list[0].main.aqi;

        document.getElementById("pm25").innerText =
            data.list[0].components.pm2_5 + " µg/m³";

        document.getElementById("pm10").innerText =
            data.list[0].components.pm10 + " µg/m³";

        document.getElementById("co").innerText =
            data.list[0].components.co + " µg/m³";

    } catch (error) {
        console.log(error);
    }

}



function searchWeather() {
    const city = cityInput.value.trim();

    if (city !== "") {
        getWeather(city);
    }
}
searchBtn.addEventListener("click", searchWeather);

cityInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        searchWeather();
    }
});
locationBtn.addEventListener("click", () => {

    navigator.geolocation.getCurrentPosition(async (position) => {

        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;

        const response = await fetch(url);
        const data = await response.json();

        getWeather(data.name);

    }, () => {
        alert("Location access denied!");
    });

});

const themeBtn = document.getElementById("themeBtn");

themeBtn.addEventListener("click", () => {

    document.body.classList.toggle("light-mode");

    const icon = themeBtn.querySelector("i");

    if(document.body.classList.contains("light-mode")){
        icon.classList.remove("fa-moon");
        icon.classList.add("fa-sun");
    }else{
        icon.classList.remove("fa-sun");
        icon.classList.add("fa-moon");
    }

});