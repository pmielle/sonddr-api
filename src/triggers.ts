import { Subject } from "rxjs";

import { Change, DbDiscussion, Notification, DbMessage } from "sonddr-shared";
import { watchCollection } from "./database.js";
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

export const discussionsChanges$: Subject<Change<DbDiscussion>> = new Subject();
watchCollection<DbDiscussion>("discussions").subscribe(discussionsChanges$);

export const messagesChanges$: Subject<Change<DbMessage>> = new Subject();
watchCollection<DbMessage>("messages").subscribe(messagesChanges$);
