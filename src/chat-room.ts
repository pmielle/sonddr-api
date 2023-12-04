import { Subscription } from "rxjs";
import { getDocuments } from "./database.js";
import { Change, DbMessage, Message } from "sonddr-shared";
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
		const oldMessages = await this._getOldMessages();
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

	async _getOldMessages(): Promise<Message[]> {
		const dbDocs = await getDocuments<DbMessage>("messages", {field: "date", desc: true});
		const docs = await reviveMessages(dbDocs);
		return docs;
	}

	_listenToDatabase() {
		this.databaseSub = messagesChanges$.subscribe(change => {
			this.clients.forEach(client => {
				this._send(change, client);
			});
		});
	}

}
