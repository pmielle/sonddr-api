mongo <<EOF

db = db.getSiblingDB('$MONGO_DATABASE')

db.createCollection("goals")
db.createCollection("ideas")

db.createUser({
    user: '$MONGO_WEB_USER',
    pwd: '$MONGO_WEB_PASSWORD',
    roles: ['readWrite']
})

EOF