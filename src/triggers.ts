import { Change, DbDiscussion, Discussion, Notification } from "sonddr-shared";
import { watchCollection } from "./database.js";
import { Subject, switchMap } from "rxjs";
import { reviveDiscussion } from "./revivers.js";

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
