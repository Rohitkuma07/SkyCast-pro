const API_KEY = "40a1961c537478f871f4980425209858";
const BASE_URL = "https://api.openweathermap.org/data/2.5/weather";
const FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";
const ENV_URL = "https://api.open-meteo.com/v1/forecast";

/* -------------------------------------------------------------------------
   Shared data bridge for the AI Weather Lifestyle Assistant.
   It collects the SAME responses the dashboard already fetches, so the
   assistant never triggers a duplicate weather/dashboard request.
   The only extra call is the optional, key-free Open-Meteo enrichment
   (UV + hourly detail), which OpenWeatherMap's free tier does not provide.
   ------------------------------------------------------------------------- */
window.SkyCastData = window.SkyCastData || {
    current: null,
    forecast: null,
    aqi: null,
    env: null,
    updatedAt: null
};

function publishSkyCast(patch) {
    if (!window.SkyCastData) window.SkyCastData = {};
    Object.assign(window.SkyCastData, patch, { updatedAt: Date.now() });
    try {
        window.dispatchEvent(new CustomEvent("skycast:update", { detail: window.SkyCastData }));
    } catch (e) { /* very old browsers: assistant simply won't auto-update */ }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

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

    try { window.dispatchEvent(new CustomEvent("skycast:error", { detail: { message: "City not found. Please enter a valid city." } })); } catch (e) {}

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
            "Wind : " + Math.round(data.wind.speed * 3.6) + " km/h";

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

// keep the existing highlight cards in sync with real values
setText("highlightHumidity", Math.round(data.main.humidity) + "%");
setText("highlightWind", Math.round(data.wind.speed * 3.6) + " km/h");
setText("highlightVisibility", data.visibility != null
    ? (data.visibility / 1000).toFixed(data.visibility % 1000 === 0 ? 0 : 1) + " km"
    : "—");

// publish to the AI assistant BEFORE the slower enrichments resolve
publishSkyCast({ current: data });
try { localStorage.setItem("skycast_last_city", data.name); } catch (e) {}

getAQI(lat, lon);
getEnv(lat, lon);
updateMap(lat, lon, data.name);
document.getElementById("loader").style.display = "none";

    } catch (error) {
     document.getElementById("loader").style.display = "none";
    console.log(error);
    showError("Something went wrong. Please try again.");
    try { window.dispatchEvent(new CustomEvent("skycast:error", { detail: { message: "Something went wrong. Please try again." } })); } catch (e) {}

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

    updateChart(labels, temps);

    publishSkyCast({ forecast: data });

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

        publishSkyCast({ aqi: data });

    } catch (error) {
        console.log(error);
    }

}

/* ---------------------------------------------------------------
   Optional environmental enrichment: UV index, hourly precipitation
   probability, apparent temperature, humidity, wind, visibility.
   Source: Open-Meteo (https://open-meteo.com) — free, no API key.
   If it fails, the assistant simply reports UV/hourly detail as
   unavailable and keeps working.
   --------------------------------------------------------------- */
const _envCache = {};

async function getEnv(lat, lon) {

    const key = Math.round(lat * 100) / 100 + "," + Math.round(lon * 100) / 100;

    try {

        const cached = _envCache[key];
        if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
            publishSkyCast({ env: cached.data });
            setText("uvValue", formatUV(cached.data));
            return;
        }

        const url = ENV_URL +
            `?latitude=${lat}&longitude=${lon}` +
            "&current=uv_index,temperature_2m,relative_humidity_2m,weather_code" +
            "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m," +
            "precipitation_probability,precipitation,wind_speed_10m,uv_index,weather_code,visibility" +
            "&forecast_days=2&timezone=auto";

        const response = await fetch(url);
        const data = await response.json();

        if (!data || !data.hourly) throw new Error("no env data");

        _envCache[key] = { at: Date.now(), data: data };

        publishSkyCast({ env: data });
        setText("uvValue", formatUV(data));

    } catch (error) {
        console.log("Env (UV/hourly) unavailable:", error.message);
        setText("uvValue", "—");
    }

}

function formatUV(data) {
    if (data && data.current && data.current.uv_index != null) {
        return Math.round(data.current.uv_index * 10) / 10 + "";
    }
    return "—";
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