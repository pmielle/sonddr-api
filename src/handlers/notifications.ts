import { Request, Response, NextFunction } from "express";
import { filter as rxFilter } from "rxjs";

import { Change, Notification, ping_str } from "sonddr-shared";
import { SSE } from "../sse";
import { getDocuments, patchDocument } from "../database";
import { _getFromReqBody, _getReqPath, _getUnique } from "../handlers";
import { notificationsChanges$ } from "../triggers";


export async function getNotifications(req: Request, res: Response, next: NextFunction) {
	const userId = req["userId"];
	const sse = new SSE(res);
	const docs = await getDocuments<Notification>(
		_getReqPath(req),
		{ field: "date", desc: true },
		{ field: "toIds", operator: "in", value: [userId] },
	);
	sse.send(docs);
	const changesSub = notificationsChanges$.pipe(
		rxFilter(change => _getToIdsOfNotificationChange(change).includes(userId)),
	).subscribe(change => sse.send(change));
	// heartbeat to keep the connection alive
	// otherwise nginx timeouts after 60s
	const pingId = setInterval(() => sse.send(ping_str), 30000);
	req.on("close", () => {
		clearInterval(pingId);
		changesSub.unsubscribe()
	});
}

export async function patchNotification(req: Request, res: Response, next: NextFunction) {
	await patchDocument(
		_getReqPath(req),
		{ field: 'readByIds', operator: 'addToSet', value: req["userId"] }
	);
	res.send();
}


// private
// --------------------------------------------
function _getToIdsOfNotificationChange(change: Change<Notification>): string[] {
	const toIds = change.docBefore?.toIds || change.docAfter?.toIds;
	if (!toIds) { throw new Error("Failed to find toIds of change"); }
	return toIds;
}

