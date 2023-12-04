import { Change, DbDiscussion, Discussion, Notification, Message, DbMessage } from "sonddr-shared";
import { watchCollection } from "./database.js";
import { Subject, switchMap } from "rxjs";
import { reviveMessage, reviveDiscussion } from "./revivers.js";

export const notificationsChanges$: Subject<Change<Notification>> = new Subject();
watchCollection<Notification>("notifications").subscribe(notificationsChanges$);

export const discussionsChanges$: Subject<Change<Discussion>> = new Subject(); 
watchCollection<DbDiscussion>("discussions").pipe(
    switchMap(async change => {
        let revivedPayload: Discussion|undefined;
        if (change.payload) {
            revivedPayload = await reviveDiscussion(change.payload);
        } else {
            revivedPayload = undefined;
        }
        return {...change, payload: revivedPayload};
    })
).subscribe(discussionsChanges$);

export const messagesChanges$: Subject<Change<Message>> = new Subject(); 
watchCollection<DbMessage>("messages").pipe(
    switchMap(async change => {
        let revivedPayload: Message|undefined;
        if (change.payload) {
            revivedPayload = await reviveMessage(change.payload);
        } else {
            revivedPayload = undefined;
        }
        return {...change, payload: revivedPayload};
    })
).subscribe(messagesChanges$);
