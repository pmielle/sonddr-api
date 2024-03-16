import { Subject, switchMap } from "rxjs";

import { Change, DbDiscussion, Discussion, Notification, Message, DbMessage } from "sonddr-shared";
import { watchCollection } from "./database.js";
import { reviveMessage, reviveDiscussion, reviveChange } from "./revivers.js";
import { watchComments } from "./triggers/comments.js";
import { watchIdeas } from "./triggers/ideas.js";
import { watchVotes } from "./triggers/votes.js";
import { watchCheers } from "./triggers/cheers.js";


// init private triggers
// ----------------------------------------------
export function startAllTriggers() {
	watchComments();
	watchIdeas();
	watchVotes();
	watchCheers();
}


// change streams
// ----------------------------------------------
export const notificationsChanges$: Subject<Change<Notification>> = new Subject();
watchCollection<Notification>("notifications").subscribe(notificationsChanges$);

export const discussionsChanges$: Subject<Change<Discussion>> = new Subject();
watchCollection<DbDiscussion>("discussions").pipe(
	switchMap(async change => await reviveChange(change, reviveDiscussion))
).subscribe(discussionsChanges$);

export const messagesChanges$: Subject<Change<Message>> = new Subject();
watchCollection<DbMessage>("messages").pipe(
	switchMap(async change => await reviveChange(change, reviveMessage))
).subscribe(messagesChanges$);
