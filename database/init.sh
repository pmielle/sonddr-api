mongo <<EOF

// target the main database
// ------------------------
db = db.getSiblingDB('$MONGO_DATABASE')

// create the collections
// ----------------------
db.createCollection("goals")
db.createCollection("ideas")

// init the goals
// --------------
db.goals.insertMany([
	{name: "No poverty"},
	{name: "Quality education"}
])

// create the web user that is used by the api
// -------------------------------------------
db.createUser({
    user: '$MONGO_WEB_USER',
    pwd: '$MONGO_WEB_PASSWORD',
    roles: ['readWrite']
})

EOF
