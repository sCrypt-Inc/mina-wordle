import {
  Bool,
  isReady,
  method,
  Mina,
  Party,
  PrivateKey,
  Proof,
  shutdown,
  SmartContract,
  State,
  state,
  Field,
} from 'snarkyjs';

import {
    Word, Clues, WordleState, Wordle
} from './WordleRecursive.js';
import { tic, toc } from './tictoc.js';

await isReady;

tic('compiling');
await Wordle.compile();
toc();

let solutionRaw = [18, 12, 0, 17, 19]; // "SMART"
let solution = new Word(Word.serializeRaw(solutionRaw));

let salt = new Field(123);
let solutionCommit = solution.hash(salt)

// initialize (== create the first proof)
tic('prove (init)');

let nRow = new Field(0);
let clues = new Field(0);
let playersTurn = new Bool(false);
let gameFinished = new Bool(false);
let lastGuess = new Word(Word.serializeRaw([0, 0, 0, 0, 0]));

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
let guessRaw = [18, 13, 0, 8, 11]; // "SNAIL"
let guess = new Word(Word.serializeRaw(solutionRaw));

let userState = new WordleState(
      initialProof.publicInput.salt,
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
let serverState = new WordleState(
      userProof.publicInput.salt,
      userProof.publicInput.solutionCommit,
      userProof.publicInput.nRow.add(1), // Increment row
      userProof.publicInput.clues, // TODO Update clues
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

guessRaw = [18, 19, 0, 17, 19]; // "START"
guess = new Word(Word.serializeRaw(solutionRaw));

userState = new WordleState(
      serverProof.publicInput.salt,
      serverProof.publicInput.solutionCommit,
      serverProof.publicInput.nRow,
      serverProof.publicInput.clues,
      new Bool(false), // flip playersTurn flag
      serverProof.publicInput.gameFinished,
      guess, // Set last guess 
    );
userProof = await Wordle.updatePlayer(userState, guess, initialProof);
toc();

console.log('Guess Valid!');

// server published another clue:

tic('prove (clue)');
serverState = new WordleState(
      userProof.publicInput.salt,
      userProof.publicInput.solutionCommit,
      userProof.publicInput.nRow.add(1), // Increment row
      userProof.publicInput.clues, // TODO Update clues
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

guessRaw = [18, 12, 0, 17, 19]; // "SMART"
guess = new Word(Word.serializeRaw(solutionRaw));

userState = new WordleState(
      initialProof.publicInput.salt,
      initialProof.publicInput.solutionCommit,
      initialProof.publicInput.nRow,
      initialProof.publicInput.clues,
      new Bool(false), // flip playersTurn flag
      initialProof.publicInput.gameFinished,
      guess, // Set last guess 
    );
userProof = await Wordle.updatePlayer(userState, guess, initialProof);
toc();

console.log('Guess Valid!');

// server verifies solution marks the game finished:

tic('prove (clue)');
serverState = new WordleState(
      userProof.publicInput.salt,
      userProof.publicInput.solutionCommit,
      userProof.publicInput.nRow,
      userProof.publicInput.clues, // TODO Update clues
      new Bool(true), // flip playersTurn flag
      new Bool(true), // Game is marked as finished.
      userProof.publicInput.lastGuess,
    );
let finalProof = await Wordle.updateHouse(
  serverState,
  solution,
  userProof
);
toc();

// -----------------------

// class that describes the rolled up proof
class WordleProof extends Proof<WordleProof> {
  static publicInputType = WordleState;
  static tag = () => Wordle;
}

class WordleRollup extends SmartContract {
  @state(Bool) someoneWon = State<Bool>();

  @method publishCompletedGame(
    proof: WordleProof // <-- we're passing in a proof!
  ) {
    // verify the proof
    proof.verify();

    // declare that someone won this game!
    this.someoneWon.set(Bool(true));
  }
}

// deploy rollup

let zkAppPrivateKey = PrivateKey.random();
let zkAppAddress = zkAppPrivateKey.toPublicKey();
let zkapp = new WordleRollup(zkAppAddress);

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const publisherAccount = Local.testAccounts[0].privateKey;

tic('compile & deploy rollup');
await WordleRollup.compile(zkAppAddress);
let tx = await Mina.transaction(publisherAccount, () => {
  Party.fundNewAccount(publisherAccount);
  zkapp.deploy({ zkappKey: zkAppPrivateKey });
});
await tx.send().wait();
toc();

// prove that we have a proof that shows that we won
tic('prove (rollup)');
tx = await Mina.transaction(publisherAccount, () => {
  // call out method with final proof from the ZkProgram as argument
  zkapp.publishCompletedGame(finalProof);
});
await tx.prove();
await tx.send().wait();
toc();

console.log('Did someone win?', zkapp.someoneWon.get().toBoolean());

// this was only a single transaction, which proves the same thing as the many transactions in the non-recursive example!

shutdown();