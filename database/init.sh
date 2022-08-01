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
	{name: "No poverty", code: "no_poverty", order: NumberInt(1)},
	{name: "Health and well-being", code: "health_and_well_being", order: NumberInt(2)},
	{name: "Reduced inequalities", code: "reduced_inequalities", order: NumberInt(3)},
	{name: "Quality education", code: "quality_education", order: NumberInt(4)},
	{name: "Decent work", code: "decent_work", order: NumberInt(5)},
	{name: "Peace and justice", code: "peace_and_justice", order: NumberInt(6)},
	{name: "Sustainability", code: "sustainability", order: NumberInt(7)},
	{name: "Preserved ecosystems", code: "preserved_ecosystems", order: NumberInt(8)}
])

// create the web user that is used by the api
// -------------------------------------------
db.createUser({
    user: '$MONGO_WEB_USER',
    pwd: '$MONGO_WEB_PASSWORD',
    roles: ['readWrite']
})

EOF
