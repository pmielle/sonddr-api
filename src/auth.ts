import { NextFunction, Request, Response } from "express";
import KeycloakConnect, { Keycloak } from "keycloak-connect";
import { IncomingMessage } from "http";

import { makeMongoId } from "./database";


export class Auth {
	keycloakUrl: string;
	keycloakRealm: string;
	keycloakClient: string;
	keycloak: Keycloak;

	constructor(store: any) {
		this.keycloakUrl = this._getKeycloakUrlFromEnv();
		this.keycloakClient = "sonddr-backend";
		this.keycloakRealm = "sonddr";
		this.keycloak = new KeycloakConnect({ store: store }, {
			"auth-server-url": this.keycloakUrl,
			"realm": this.keycloakRealm,
			"resource": this.keycloakClient,
			"confidential-port": 8443,
			"bearer-only": true,
			"ssl-required": "none",
		});
	}

	async fetchUserId(req: Request, res: Response, next: NextFunction) {
		const token = (await this.keycloak.getGrant(req, res)).access_token;
		const profile = await this.keycloak.grantManager.userInfo(token);
		req["userId"] = makeMongoId(profile["sub"]).toString();
		next();
	}

	async authenticateIncomingMessage(incomingMessage: IncomingMessage): Promise<void> {
		const url = new URL(incomingMessage.url, `http://${incomingMessage.headers.host}`);
		const token = url.searchParams.get("token");
		let profile = await this.keycloak.grantManager.userInfo(token);
		incomingMessage["userId"] = makeMongoId(profile["sub"]).toString();
	}

	async authenticateRequest(req: Request): Promise<void> {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const token = url.searchParams.get("token");
		let profile = await this.keycloak.grantManager.userInfo(token);
		req["userId"] = makeMongoId(profile["sub"]).toString();
	}

	// private
	// --------------------------------------------
	_getKeycloakUrlFromEnv(): string {
		const keycloakUrl = process.env.KEYCLOAK_URL;
		if (! keycloakUrl) { throw new Error(`Failed to get KEYCLOAK_URL from env`); }
		return keycloakUrl;
	}

}


