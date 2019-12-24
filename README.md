# Automerge Simple Connection

This is a simpler, asynchronous, version of Automerge's [Connection](https://github.com/automerge/automerge/blob/master/src/connection.js) protocol, which is used to send and receive changes to Automerge documents.

Unlike the original Automerge Connection, _simple_ connection:

- Doesn't use hard-to-debug handlers
- Supports asynchronous getting and setting documents however you want
- Is written in Typescript

## Install

```
npm install --save automerge-simple-connection
```

## Usage

Async Automerge Connection assumes you're implementing an `DocStore` class that satisfies this interface:

```ts
interface AsyncDocStore {
  getDoc<T>(docId: string): Promise<Doc<T>>;
  setDoc<T>(docId: string, doc: Doc<T>): Promise<Doc<T>>;
}
```

An in-memory example might just be:

```ts
import { AsyncDocStore } from "automerge-simple-connection";

class MyDocStore extends AsyncDocStore {
  _docs = {};

  getDoc(docId) {
    return _docs[docId];
  }

  setDoc(docId, doc) {
    _docs[docId] = doc;
    return doc;
  }
}
```

Then, you'd create a `sendMsg` function that sends a generated packet over the network. For example:

```ts
function sendMsg(msg) {
  myNetwork.send(JSON.stringify(msg));
}
```

Finally, you'd create a `Connection` class and pass both your `DocStore` and your `sendMsg` function in.

```ts
import { Connection } from "automerge-simple-connection";

const connection = new Connection(new MyDocStore(), sendMsg);
```

### Broadcasting changes

To let other clients know a document changed, just call the `docChanged` function:

```ts
connection.docChanged(myDocId, myDoc);
```
