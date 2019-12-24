import { Backend, Change, Doc, Frontend, Message } from "automerge";
import { fromJS, Map } from "immutable";
import lessOrEqual from "./lessOrEqual";

// Updates the vector clock for `docId` in `clockMap` (mapping from docId to vector clock)
// by merging in the new vector clock `clock`. Returns the updated `clockMap`, in which each node's
// sequence number has been set to the maximum for that node.
function clockUnion(clockMap, docId, clock) {
  clock = clockMap.get(docId, Map()).mergeWith((x, y) => Math.max(x, y), clock);
  return clockMap.set(docId, clock);
}

export interface AsyncDocSet {
  getDoc<T>(docId: string): Promise<Doc<T>>;
  setDoc<T>(docId: string, doc: Doc<T>): Promise<Doc<T>>;
}

// Keeps track of the communication with one particular peer. Allows updates
// for many documents to be multiplexed over a single connection.
export default class Connection {
  private _docSet: AsyncDocSet;
  private _sendMsg: (msg: Message) => void;
  private _theirClock: Map<string, any>;
  private _ourClock: Map<string, any>;

  constructor(docSet: AsyncDocSet, sendMsg: (msg: Message) => void) {
    this._docSet = docSet;
    this._sendMsg = sendMsg;
    this._theirClock = Map();
    this._ourClock = Map();
  }

  sendMsg(docId: string, clock: Map<string, any>, changes?: Change[]) {
    const msg: Message = {
      docId,
      clock: clock.toJS() as { [key: string]: any }
    };
    this._ourClock = clockUnion(this._ourClock, docId, clock);
    if (changes) msg.changes = changes;
    this._sendMsg(msg);
  }

  // You must call this manually to send changes.
  docChanged(docId: string, doc: Doc<any>) {
    const state = Frontend.getBackendState(doc);
    const clock = state.getIn(["opSet", "clock"]);
    if (!clock) {
      throw new TypeError(
        "This object cannot be used for network sync. " +
          "Are you trying to sync a snapshot from the history?"
      );
    }

    if (!lessOrEqual(this._ourClock.get(docId, Map()), clock)) {
      throw new RangeError("Cannot pass an old state object to a connection");
    }

    this.maybeSendChanges(docId);
  }

  async applyChanges(docId: string, changes: Change[]): Promise<Doc<any>> {
    let doc =
      (await this._docSet.getDoc(docId)) ||
      // @ts-ignore because automerge has bad typings
      Frontend.init({ backend: Backend });

    const oldState = Frontend.getBackendState(doc);
    const [newState, patch] = Backend.applyChanges(oldState, changes);

    // @ts-ignore because automerge has bad typings
    patch.state = newState;
    doc = Frontend.applyPatch(doc, patch);
    await this._docSet.setDoc(docId, doc);
    return doc;
  }

  async receiveMsg(msg: Message) {
    if (msg.clock) {
      this._theirClock = clockUnion(
        this._theirClock,
        msg.docId,
        fromJS(msg.clock)
      );
    }
    if (msg.changes) {
      return this.applyChanges(msg.docId, fromJS(msg.changes));
    }

    if (await this._docSet.getDoc(msg.docId)) {
      this.maybeSendChanges(msg.docId);
    } else if (!this._ourClock.has(msg.docId)) {
      // If the remote node has data that we don't, immediately ask for it.
      // TODO should we sometimes exercise restraint in what we ask for?
      this.sendMsg(msg.docId, Map());
    }

    return this._docSet.getDoc(msg.docId);
  }

  private async maybeSendChanges(docId: string) {
    const doc = await this._docSet.getDoc(docId);
    const state = Frontend.getBackendState(doc);
    const clock = state.getIn(["opSet", "clock"]);

    if (this._theirClock.has(docId)) {
      const changes = Backend.getMissingChanges(
        state,
        this._theirClock.get(docId)
      );
      if (changes.length > 0) {
        this._theirClock = clockUnion(this._theirClock, docId, clock);
        this.sendMsg(docId, clock, changes);
        return;
      }
    }

    if (!clock.equals(this._ourClock.get(docId, Map())))
      this.sendMsg(docId, clock);
  }
}
