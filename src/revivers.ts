import { DbDiscussion, DbMessage, Discussion, Doc, Message, User } from "sonddr-shared";
import { getDocuments } from "./database.js";


export async function reviveMessage(dbDoc: DbMessage): Promise<Message> {
    return (await reviveMessages([dbDoc]))[0];
}

export async function reviveMessages(dbDocs: DbMessage[]): Promise<Message[]> {

    if (dbDocs.length == 0) { return []; }

    // get users
    let usersToGet = _getUniqueInArray(dbDocs, "authorId");
    const users = await getDocuments<User>(
        "users", 
        undefined, 
        {field: "id", operator: "in", value: usersToGet}
    );

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
    const users = await getDocuments<User>(
        "users", 
        undefined, 
        {field: "id", operator: "in", value: usersToGet}
    );

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
            // TODO: fix, this crashes upon delete I think
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
