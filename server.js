const express = require("express");
const multer = require("multer");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
const DATA_FILE = path.join(__dirname, "data", "plants.json");
const FAVORITES_FILE = path.join(__dirname, "data", "favorites.json");

// Serve frontend static files so the app can be opened on port 3000
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_PATH));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'index.html')));

// Enable CORS for all routes
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
}));

app.use(express.json());

const upload = multer();

// Test endpoint to verify server is working
app.get("/test", (req, res) => {
    res.json({ message: "Server is running!" });
});

app.get("/history", (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
    res.json(data);
});

app.get("/stats", (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
    const total = data.length;
    const avgWater = total
        ? data.reduce((sum, item) => sum + Number(item.water), 0) / total
        : 0;
    res.json({ total, avgWater: Number(avgWater.toFixed(2)) });
});

app.post("/favorite", async (req, res) => {
    const favorites = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8") || "[]");
    favorites.push(req.body);
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2));
    res.json({ success: true });
});

app.post("/identify", upload.single("image"), async (req, res) => {
    try {
        const imageBuffer = req.file.buffer;

        // 🌿 PlantNet API
        const formData = new FormData();
        formData.append("images", imageBuffer, "plant.jpg");

        const plantRes = await axios.post(
            `https://my-api.plantnet.org/v2/identify/all?api-key=${process.env.PLANT_API_KEY}`,
            formData,
            { headers: formData.getHeaders() }
        );

        const plantName =
            plantRes.data.results[0].species.scientificNameWithoutAuthor;

        // 📍 Get location
        const { lat, lon } = req.body;

        // 🌦️ Weather API
        const weatherRes = await axios.get(
            `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${process.env.WEATHER_API_KEY}&units=metric`
        );

        const forecast = weatherRes.data.list[0];

        const temp = forecast.main.temp;
        const humidity = forecast.main.humidity;
        const rain = forecast.rain ? forecast.rain["3h"] || 0 : 0;
        // probability of precipitation (0-1) -> percentage
        const rainChance = Math.round((forecast.pop || 0) * 100);

        // 💧 Water logic
        let water = 1;

        if (temp > 30) water += 0.5;
        if (humidity < 40) water += 0.3;
        if (rain > 0) water -= 0.7;

        if (water < 0) water = 0;

        // Watering status logic
        let status = "Good";
        if (temp > 32 && humidity < 50) {
            status = "Needs more water";
        } else if (rainChance > 60) {
            status = "Do not water";
        }

        const existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
        existing.push({
            plant: plantName,
            temperature: temp,
            humidity,
            rainChance,
            water: Number(water.toFixed(2)),
            message: "",
            date: new Date().toISOString()
        });
        fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
        // Watering recommendation message
        let message = "Water normally today.";

        if (temp > 32 && humidity < 50) {
            message = "It's hot and dry — increase watering.";
        } else if (humidity > 70) {
            message = "High humidity — reduce watering.";
        } else if (rainChance > 60) {
            message = "Rain expected — skip watering today.";
        }

        // update last entry with message
        existing[existing.length - 1].message = message;
        fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));

        res.json({
            plant: plantName,
            plantName,
            plant: plantName,
            temperature: temp,
            temp,
            humidity,
            rain,
            rainChance,
            water: Number(water.toFixed(2)),
            status,
            message
        });

    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: "Error occurred" });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));