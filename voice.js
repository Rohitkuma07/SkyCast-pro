const voiceBtn = document.getElementById("voiceBtn");
const searchInput = document.querySelector(".search-box input");

const SpeechRecognition =
window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {

    const recognition = new SpeechRecognition();

    recognition.lang = "en-IN";

    recognition.onresult = function(event){

    const city = event.results[0][0].transcript;

    searchInput.value = city;

    getWeather(city);

}

    voiceBtn.addEventListener("click", ()=>{

        recognition.start();

    });

}else{

    alert("Speech Recognition is not supported in this browser.");

}