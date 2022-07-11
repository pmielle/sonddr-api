import { expressjwt } from "express-jwt"
import jwksRsa from "jwks-rsa"


// config
// ----------------------------------------------
const auth0Issuer= "https://dev-p15u97v3.us.auth0.com"
const auth0Audience = "https://sonddr-api"
const auth0Algorithms = ['RS256']
const jwksUri=`${auth0Issuer}/.well-known/jwks.json`


// middleware
// ----------------------------------------------
export const checkJwt = expressjwt({
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${jwksUri}/.well-know/jwks.json`,
    }),
    audience: auth0Audience,
    issuer: auth0Issuer,
    algorithms: auth0Algorithms,
})