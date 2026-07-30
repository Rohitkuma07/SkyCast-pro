let weatherChart;

function updateChart(labels, temps) {

    const ctx = document.getElementById("weatherChart").getContext("2d");

const gradient = ctx.createLinearGradient(0, 0, 0, 300);

gradient.addColorStop(0, "rgba(56,189,248,0.6)");
gradient.addColorStop(1, "rgba(56,189,248,0)");

    if (weatherChart) {
        weatherChart.destroy();
    }

    weatherChart = new Chart(ctx, {
        type: "line",

        data: {
            labels: labels,

            datasets: [{
                label: "Temperature (°C)",
                data: temps,
                borderColor: "#38bdf8",
backgroundColor: gradient,
borderWidth: 4,
pointRadius: 5,
pointHoverRadius: 8,
pointBackgroundColor: "#38bdf8",
pointBorderColor: "#ffffff",
pointHoverBorderWidth: 3,
pointBorderWidth: 2,
hoverBorderWidth: 5,
fill: true,
tension: 0.45
            }]
        },

        options: {
    responsive: true,
    maintainAspectRatio: false,

    animation:{
        duration:1500,
        easing:"easeInOutQuart"
    },

            plugins: {
                legend: {
                    labels: {
                        color: "white"
                    }
                }
            },

            scales: {
    x: {
        grid: {
            color: "rgba(255,255,255,0.08)"
        },
        ticks: {
            color: "white"
        }
    },

    y: {
        grid: {
            color: "rgba(255,255,255,0.08)"
        },
        ticks: {
            color: "white"
        }
    }
}
        }
    });

}