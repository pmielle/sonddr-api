import cors from "cors";
import express from "express";

const port = 3000;
const app = express();
app.use(cors({origin: "http://localhost:4200"}));

app.get('/', (req, res) => {
    res.json(null);
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});