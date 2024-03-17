import { NextFunction, Request, Response } from "express";
import KeycloakConnect, { Keycloak } from "keycloak-connect";
import { IncomingMessage } from "http";

import { makeMongoId } from "./database.js";


// don't forget to call init_keycloak(store) to initialize it 
// once a store has been init
export let keycloak: Keycloak; 

export function init_keycloak(store: any) {
	let keycloakUrl =  _getKeycloakUrlFromEnv();
	const keycloakRealm = "sonddr";
	const keycloakClient = "sonddr-backend";
	keycloak = new KeycloakConnect({ store: store }, {
		"auth-server-url": keycloakUrl,
		"realm": keycloakRealm,
		"resource": keycloakClient,
		"confidential-port": 8443,
		"bearer-only": true,
		"ssl-required": "none",
	});
}

export async function fetchUserId(req: Request, res: Response, next: NextFunction) {
	const token = (await keycloak.getGrant(req, res)).access_token;
	const profile = await keycloak.grantManager.userInfo(token);
	req["userId"] = makeMongoId(profile["sub"]).toString();
	next();
}

export async function authenticateIncomingMessage(incomingMessage: IncomingMessage): Promise<void> {
	const url = new URL(incomingMessage.url, `http://${incomingMessage.headers.host}`);
		const token = url.searchParams.get("token");
	let profile = await keycloak.grantManager.userInfo(token);
	incomingMessage["userId"] = makeMongoId(profile["sub"]).toString();
}

export async function authenticateRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
	const url = new URL(req.url, `http://${req.headers.host}`);
		const token = url.searchParams.get("token");
	let profile = await keycloak.grantManager.userInfo(token);
	req["userId"] = makeMongoId(profile["sub"]).toString();
	next();
}

// private
// --------------------------------------------
function _getKeycloakUrlFromEnv(): string {
	const keycloakUrl = process.env.KEYCLOAK_URL;
	if (! keycloakUrl) { throw new Error(`Failed to get KEYCLOAK_URL from env`); }
	return keycloakUrl;
}



