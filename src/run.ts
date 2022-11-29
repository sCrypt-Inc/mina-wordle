import {
  Permissions,
  PrivateKey,
  Mina,
  AccountUpdate,
  isReady,
  shutdown,
  Field,
} from 'snarkyjs';

import { Word, Wordle } from './Wordle.js';

await isReady;

function mapToFieldElems(inArr: number[]): Field[] {
    return inArr.map(function (x: number) { return new Field(x); });
}

let withProofs = true;

let zkAppPrivateKey = PrivateKey.random();
let zkAppAddress = zkAppPrivateKey.toPublicKey();
let zkapp = new Wordle(zkAppAddress);

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const publisherAccount = Local.testAccounts[0].privateKey;
console.log('Local Blockchain Online!');

if (withProofs) {
  console.log('compiling...');
  await Wordle.compile();
}

let solutionRaw = mapToFieldElems([18, 12, 0, 17, 19]); // "SMART"
let solution = new Word(Word.serializeRaw(solutionRaw));
let salt = new Field(123);

let tx = await Mina.transaction(publisherAccount, () => {
  AccountUpdate.fundNewAccount(publisherAccount);
  zkapp.deploy({ zkappKey: zkAppPrivateKey });
  if (!withProofs) {
    zkapp.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }
});
tx.send();

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.init(salt, solution);
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Contract deployed and initialized!');

//-----------------------

let guessRaw = mapToFieldElems([18, 13, 0, 8, 11]); // "SNAIL"
let guess = new Word(Word.serializeRaw(solutionRaw));
tx = await Mina.transaction(publisherAccount, () => {
  zkapp.updatePlayer(guess.serialize());
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Guess Submitted!');

//-----------------------

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.updateHouse(solution.serialize());
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Clues: ' + zkapp.clues.get().toString());

//-----------------------

guessRaw = mapToFieldElems([18, 19, 0, 17, 19]); // "START"
guess = new Word(Word.serializeRaw(solutionRaw));
tx = await Mina.transaction(publisherAccount, () => {
  zkapp.updatePlayer(guess.serialize());
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Guess Submitted!');

//---------------------

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.updateHouse(solution.serialize());
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Clues: ' + zkapp.clues.get().toString());


//-----------------------

guessRaw = mapToFieldElems([18, 12, 0, 17, 19]); // "SMART"
guess = new Word(Word.serializeRaw(solutionRaw));
tx = await Mina.transaction(publisherAccount, () => {
  zkapp.updatePlayer(guess.serialize());
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Guess Submitted!');

//-----------------------

tx = await Mina.transaction(publisherAccount, () => {
  zkapp.updateHouse(solution.serialize());
  if (!withProofs) zkapp.sign(zkAppPrivateKey);
});
if (withProofs) {
  console.log('proving...');
  await tx.prove();
}
tx.send();

console.log('Clues: ' + zkapp.clues.get().toString());

shutdown();