import express from "express"
import bodyParser from "body-parser"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"

import { addIdeasRoutes } from "./routes/ideas.js"
import { addGoalsRoutes } from "./routes/goals.js"
import { connectToDatabase } from "./database/database.js"
import { checkJwt } from "./authentication/authentication.js"


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
// require jwt
app.use(checkJwt)

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
