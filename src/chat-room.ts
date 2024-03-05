import { WebSocket } from "ws";
import { Subscription, filter as rxFilter } from "rxjs";

import { Change, DbMessage, Message, placeholder_id } from "sonddr-shared";
import { getDocuments } from "./database.js";
import { reviveMessages } from "./revivers.js";
import { messagesChanges$ } from "./triggers.js";


export class ChatRoomManager {

	rooms = new Map<string, ChatRoom>();  // keys are discussion IDs

	constructor() {}

	getOrCreateRoom(discussionId: string, userId: string, socket: WebSocket): ChatRoom {
		let room: ChatRoom;
		if (this.rooms.has(discussionId)) {
			room = this.rooms.get(discussionId);
			room.join(userId, socket);
		} else {
			room = new ChatRoom(discussionId, userId, socket);  // no need to join the room after, it is done in init()
			this.rooms.set(discussionId, room);
		}
		return room;
	}

	leaveRoom(room: ChatRoom, userId: string) {
		room.leave(userId);
		if (room.isEmpty) {
			room.disable();  // cancel any subscription before gc
			this.rooms.delete(room.discussionId);
		}
	}

}

export class ChatRoom {

	discussionId: string;
	databaseSub?: Subscription;
	clients = new Map<string, WebSocket>();  // keys are user IDs

	constructor(discussionId: string, firstUserId: string, firstUserSocket: WebSocket) {
		this.discussionId = discussionId;
		this._init(firstUserId, firstUserSocket);
	}

	async join(userId: string, socket: WebSocket) {
		const oldMessages = await this._getOldMessages(userId);
		this._send(oldMessages, socket);
		this.clients.set(userId, socket);
	}

	leave(userId: string) {
		this.clients.delete(userId);
	}

	isEmpty(): boolean {
		return this.clients.size === 0;
	}

	disable() {
		this.databaseSub?.unsubscribe();
	}

	// private
	// ------------------------------------------
	_send(payload: Message[]|Change<Message>, socket: WebSocket) {
		socket.send(JSON.stringify(payload));
	}

	async _init(firstUserId: string, firstUserSocket: WebSocket) {
		await this.join(firstUserId, firstUserSocket);
		this._listenToDatabase();
	}

	async _getOldMessages(userId: string): Promise<Message[]> {
		const docs = await getDocuments<DbMessage>(
			"messages",
			{field: "date", desc: true},
			{field: "discussionId", operator: "eq", value: this.discussionId},
		).then(dbDocs => reviveMessages(dbDocs, userId));
		return docs;
	}

	_listenToDatabase() {
		this.databaseSub = messagesChanges$.pipe(
			rxFilter(change => this._getDiscussionIdOfChange(change) === this.discussionId),
		).subscribe(change => {
			for (const [userId, ws] of this.clients) {
				// finish revival of user object
				const isUser = this._getAuthorIdOfChange(change) === userId
				if (change.docBefore) { change.docBefore.author.isUser = isUser }
				if (change.docAfter) { change.docAfter.author.isUser = isUser }
				// a placeholder is inserted client side when a message is send
				// change the type to "update" for this specific client to replace the placeholder
				const changeToSend = (isUser && change.type === "insert")
					? { ...change, type: "update", docId: placeholder_id } as Change<Message>
					: change;
				// actually send
				this._send(changeToSend, ws);
			}
		});
	}

	_getDiscussionIdOfChange(change: Change<Message>): string {
		const discussionId = change.docBefore?.discussionId || change.docAfter?.discussionId;
		if (! discussionId) { throw new Error("Failed to find discussionId of change"); }
		return discussionId;
	}

	_getAuthorIdOfChange(change: Change<Message>): string {
		const authorId = change.docBefore?.author.id || change.docAfter?.author.id;
		if (! authorId) { throw new Error("Failed to find authorId of change"); }
		return authorId;
	}

}
