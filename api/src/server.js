import express from "express"
import bodyParser from "body-parser"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import { addIdeasRoutes } from "./routes/ideas.js"
import { addGoalsRoutes } from "./routes/goals.js"
import { connectToDatabase } from "./database/database.js"
import { auth } from "express-openid-connect"


// config
// ----------------------------------------------
const port = 3000


// init
// ----------------------------------------------
// create the express app
const app = express()


// global middlewares
// ----------------------------------------------
// helmet enhances security
app.use(helmet())
// body-parser parses JSON bodies
app.use(bodyParser.json())
// enable CORS for all requests
app.use(cors())
// cool logs
app.use(morgan("combined"))
// auth0
app.use(auth())


// routes
// ----------------------------------------------
addIdeasRoutes(app);
addGoalsRoutes(app);


// start the database
// ----------------------------------------------
await connectToDatabase()


// start the server
// ----------------------------------------------
app.listen(port, () => {
    console.log("listening on port " + port + "...")
});
