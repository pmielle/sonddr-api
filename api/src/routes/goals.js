import { getCollection, getDocument } from "../database/database.js"

export function addGoalsRoutes(app) {

    const endpoint = "/goals"
    const databaseCollectionId = "goals"

    app.get(endpoint, async (req, res, next) => {
        try {
            res.json(await getCollection(databaseCollectionId))
        } catch (err) { next(err) }
    })

    app.get(`${endpoint}/:id`, async (req, res, next) => {
        try {
            res.json(await getDocument(databaseCollectionId, req.params.id))
        } catch (err) { next(err) }
    }) 

}