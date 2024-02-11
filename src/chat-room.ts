import { Subscription, map, pipe, filter as rxFilter } from "rxjs";
import { getDocuments } from "./database.js";
import { Change, DbMessage, Message, placeholder_id } from "sonddr-shared";
import { reviveMessages } from "./revivers.js";
import { WebSocket } from "ws";
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
			room = new ChatRoom(discussionId, userId, socket);  // constructor calls join()
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
			rxFilter(change => change.payload.discussionId === this.discussionId),
		).subscribe(change => {
			for (const [userId, ws] of this.clients) {
				// finish revival of user object
				change.payload.author.isUser = change.payload.author.id === userId
				// a placeholder is inserted client side when a message is send
				// change the type to "update" for this specific client to replace the placeholder
				const changeToSend = (change.type === "insert" && change.payload.author.id === userId)
					? { ...change, type: "update", docId: placeholder_id } as Change<Message>
					: change;
				// actually send
				this._send(changeToSend, ws);
			}
		});
	}

}
