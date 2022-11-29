import {
  Bool,
  isReady,
  method,
  Mina,
  AccountUpdate,
  PrivateKey,
  Proof,
  shutdown,
  SmartContract,
  State,
  state,
  Field,
} from 'snarkyjs';

import {
    Word, Clues, WordleState, Wordle, WordleProof, WordleRollup
} from './WordleRecursive.js';
import { tic, toc } from './tictoc.js';

await isReady;

function mapToFieldElems(inArr: number[]): Field[] {
    return inArr.map(function (x: number) { return new Field(x); });
}

tic('compiling');
await Wordle.compile();
toc();

let solutionRaw = mapToFieldElems([18, 12, 0, 17, 19]); // "SMART"
let solution = new Word(Word.serializeRaw(solutionRaw));

let salt = new Field(123);
let solutionCommit = solution.hash(salt)

// initialize (== create the first proof)
tic('prove (init)');

let nRow = new Field(0);
let clues = new Clues(new Field(0));
let playersTurn = new Bool(true);
let gameFinished = new Bool(false);
let lastGuess = new Word(Word.serializeRaw(mapToFieldElems([0, 0, 0, 0, 0])));

let initialState = new WordleState(
    salt,
    solutionCommit,
    nRow,
    clues,
    playersTurn,
    gameFinished,
    lastGuess
);
let initialProof = await Wordle.init(initialState, solution); // <-- no class instantiation, just calling a function to create proof
toc();

console.log('Proof state initialized!');

// to make a guess, a user would fetch the initial proof from a server, and then run this:

tic('prove (guess)');
let guessRaw = mapToFieldElems([18, 13, 0, 8, 11]); // "SNAIL"
let guess = new Word(Word.serializeRaw(guessRaw));

let userState = new WordleState(
      initialProof.publicInput.commitSalt,
      initialProof.publicInput.solutionCommit,
      initialProof.publicInput.nRow,
      initialProof.publicInput.clues,
      new Bool(false), // flip playersTurn flag
      initialProof.publicInput.gameFinished,
      guess, // Set last guess 
    );
let userProof = await Wordle.updatePlayer(userState, guess, initialProof);
toc();

console.log('Guess Valid!');

// user would now post the userProof to the server, and wait for it to publish a clue in form of another proof

tic('prove (clue)');
nRow = userProof.publicInput.nRow.add(1); // Increment row
userProof.publicInput.clues.update(solution, userProof.publicInput.lastGuess, nRow);
let serverState = new WordleState(
      userProof.publicInput.commitSalt,
      userProof.publicInput.solutionCommit,
      nRow,
      userProof.publicInput.clues,
      new Bool(true), // flip playersTurn flag
      userProof.publicInput.gameFinished,
      userProof.publicInput.lastGuess,
    );
    
let serverProof = await Wordle.updateHouse(
  serverState,
  solution,
  userProof
);
toc();

console.log('Clues: ' + serverProof.publicInput.clues.toString());

// back to the user, who makes another guess:

tic('prove (guess)');
guessRaw = mapToFieldElems([18, 19, 0, 17, 19]); // "START"
guess = new Word(Word.serializeRaw(guessRaw));

userState = new WordleState(
      serverProof.publicInput.commitSalt,
      serverProof.publicInput.solutionCommit,
      serverProof.publicInput.nRow,
      serverProof.publicInput.clues,
      new Bool(false), // flip playersTurn flag
      serverProof.publicInput.gameFinished,
      guess, // Set last guess 
    );
userProof = await Wordle.updatePlayer(userState, guess, serverProof);
toc();

console.log('Guess Valid!');

// server published another clue:

tic('prove (clue)');
nRow = userProof.publicInput.nRow.add(1); // Increment row
userProof.publicInput.clues.update(solution, userProof.publicInput.lastGuess, nRow);
serverState = new WordleState(
      userProof.publicInput.commitSalt,
      userProof.publicInput.solutionCommit,
      nRow,
      userProof.publicInput.clues,
      new Bool(true), // flip playersTurn flag
      userProof.publicInput.gameFinished,
      userProof.publicInput.lastGuess,
    );
serverProof = await Wordle.updateHouse(
  serverState,
  solution,
  userProof
);
toc();

console.log('Clues: ' + serverProof.publicInput.clues.toString());

// Winning move by the player

tic('prove (guess)');
guessRaw = mapToFieldElems([18, 12, 0, 17, 19]); // "SMART"
guess = new Word(Word.serializeRaw(guessRaw));

userState = new WordleState(
      serverProof.publicInput.commitSalt,
      serverProof.publicInput.solutionCommit,
      serverProof.publicInput.nRow,
      serverProof.publicInput.clues,
      new Bool(false), // flip playersTurn flag
      serverProof.publicInput.gameFinished,
      guess, // Set last guess 
    );
userProof = await Wordle.updatePlayer(userState, guess, serverProof);
toc();

console.log('Guess Valid!');

// server verifies solution marks the game finished:

tic('prove (clue)');
nRow = userProof.publicInput.nRow.add(1); // Increment row
userProof.publicInput.clues.update(solution, userProof.publicInput.lastGuess, nRow);
serverState = new WordleState(
      userProof.publicInput.commitSalt,
      userProof.publicInput.solutionCommit,
      nRow,
      userProof.publicInput.clues,
      new Bool(true), // flip playersTurn flag
      new Bool(true), // mark game as finished
      userProof.publicInput.lastGuess,
    );
let finalProof = await Wordle.updateHouse(
  serverState,
  solution,
  userProof
);
toc();

// -----------------------

// deploy rollup

//let zkAppPrivateKey = PrivateKey.random();
//let zkAppAddress = zkAppPrivateKey.toPublicKey();
//let zkapp = new WordleRollup(zkAppAddress);
//
//let Local = Mina.LocalBlockchain();
//Mina.setActiveInstance(Local);
//const publisherAccount = Local.testAccounts[0].privateKey;
//
//tic('compile & deploy rollup');
//await WordleRollup.compile();
//let tx = await Mina.transaction(publisherAccount, () => {
//  AccountUpdate.fundNewAccount(publisherAccount);
//  zkapp.deploy({ zkappKey: zkAppPrivateKey });
//});
//await tx.send();
//toc();
//
//// prove that we have a proof that shows that we won
//tic('prove (rollup)');
//tx = await Mina.transaction(publisherAccount, () => {
//  // call out method with final proof from the ZkProgram as argument
//  zkapp.publishCompletedGame(finalProof);
//});
//await tx.prove();
//await tx.send();
//toc();
//
//console.log('Did someone win?', zkapp.someoneWon.get().toBoolean());
//
//// this was only a single transaction, which proves the same thing as the many transactions in the non-recursive example!
//
//shutdown();