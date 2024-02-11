import { DbDiscussion, DbMessage, User, DbUser, Discussion, Doc, Message } from "sonddr-shared";
import { getDocuments } from "./database.js";


export function reviveUser(dbDoc: DbUser, userId: string|undefined): User {
	return reviveUsers([dbDoc], userId)[0];
}

export function reviveUsers(dbDocs: DbUser[], userId: string|undefined): User[] {

    if (dbDocs.length == 0) { return []; }

    // convert dbDocs into docs
    const docs: User[] = dbDocs.map((dbDoc) => {
        dbDoc["isUser"] = userId === undefined ? undefined : dbDoc.id === userId;
        return dbDoc as any;
    });

    // return
    return docs;

}

export async function reviveMessage(dbDoc: DbMessage, userId: string|undefined): Promise<Message> {
    return (await reviveMessages([dbDoc], userId))[0];
}

export async function reviveMessages(dbDocs: DbMessage[], userId: string|undefined): Promise<Message[]> {

    if (dbDocs.length == 0) { return []; }

    // get users
    let usersToGet = _getUnique(dbDocs, "authorId");
    const users = await getDocuments<DbUser>(
        "users", 
        undefined, 
        {field: "id", operator: "in", value: usersToGet}
    ).then(dbDocs => reviveUsers(dbDocs, userId));

    // convert dbDocs into docs
    const docs: Message[] = dbDocs.map((dbDoc) => {
        const {authorId, ...data} = dbDoc;
        data["author"] = users.find(u => u.id === authorId);
        return data as any;
    });

    // return
    return docs;

}

export async function reviveDiscussion(dbDoc: DbDiscussion): Promise<Discussion> {
    return (await reviveDiscussions([dbDoc]))[0];
}

export async function reviveDiscussions(dbDocs: DbDiscussion[]): Promise<Discussion[]> {

    if (dbDocs.length == 0) { return []; }

    // get lastMessages
    const messagesToGet = _getUnique(dbDocs, "lastMessageId");
    let messageDocs: DbMessage[] = [];
    if (messagesToGet.length) {
        messageDocs = await getDocuments<DbMessage>(
            "messages",
            undefined,
            {field: "id", operator: "in", value: messagesToGet}
        );
    }

    // get users (userIds + lastMessages authorIds)
    let usersToGet = _getUniqueInArray(dbDocs, "userIds");
    usersToGet.concat(_getUnique(messageDocs, "authorId"));
    const users = await getDocuments<DbUser>(
        "users", 
        undefined, 
        {field: "id", operator: "in", value: usersToGet}
    ).then(dbDocs => reviveUsers(dbDocs, undefined));

    // convert dbDocs into docs
    const messages: Message[] = messageDocs.map((dbDoc) => {
        const {authorId, ...data} = dbDoc;
        data["author"] = users.find(u => u.id === authorId);
        return data as any;
    });
    const docs: Discussion[] = dbDocs.map((dbDoc) => {
        const {userIds, lastMessageId, ...data} = dbDoc;
        data["users"] = users.filter(u => userIds.includes(u.id));
        data["lastMessage"] = messages.find(m => m.id === lastMessageId);
        return data as any // typescript?? 
    });

    // return
    return docs;
}


// private
// ----------------------------------------------
function _getUnique<T extends Doc, U extends keyof T>(collection: T[], key: U): T[U][] {
    return Array.from(collection.reduce((result, current) => {
        if (key in current) {  // key might be optional
            result.add(current[key] as T[U]);
        }
        return result;
    }, new Set<T[U]>).values());
}

function _getUniqueInArray<T, U extends keyof T>(collection: T[], key: U): T[U] {
    return Array.from(collection.reduce((result, current) => {
        (current[key] as any).forEach((item: any) => {
            result.add(item);
        });
        return result;
    }, new Set<any>).values()) as T[U];
}
