import {
  Field,
  Poseidon,
  Bool,
  ZkProgram,
  CircuitValue,
  prop,
  SelfProof,
} from 'snarkyjs';

// We need a minimum of 5 bits to represent 26 uppercase english letters.

// The alphabet can be represented by decimal values as the following:
// A -> 0
// B -> 1
// C -> 2
// D -> 3
// E -> 4
// F -> 5
// G -> 6
// H -> 7
// I -> 8
// J -> 9
// K -> 10
// L -> 11
// M -> 12
// N -> 13
// O -> 14
// P -> 15
// Q -> 16
// R -> 17
// S -> 18
// T -> 19
// U -> 20
// V -> 21
// W -> 22
// X -> 23
// Y -> 24
// Z -> 25

export class Word {
  static readonly N_LETTERS = 5;
  static readonly N_LETTER_BITS = 5;

  word: Field[];

  constructor(serializedWord: Field) {
    const wordBits = serializedWord.toBits();
    for (let i = 0; i < Word.N_LETTERS; i++) {
      let letterBits = [];
      for (let j = 0; j < Word.N_LETTER_BITS; j++) {
        letterBits.push(wordBits[i * Word.N_LETTER_BITS + j]);
      }
      this.word.push(Field.ofBits(letterBits)); 
    }
  }

  serialize(): Field {
    let wordBits = [];
    for (let i = 0; i < Word.N_LETTERS; i++) {
      let letterBits = this.word[i].toBits();
      for (let j = 0; j < Word.N_LETTER_BITS; j++) {
        wordBits.push(letterBits[j]);
      }
    }
    return Field.ofBits(wordBits);
  }

  getChar(i: number): Field {
    return this.word[i];
  }
  
  hash(salt: Field): Field {
    return Poseidon.hash([salt, this.serialize()]);
  }
  
  isNone(): Bool {
    let ret = new Bool(true);
    for (let i = 0; i < Word.N_LETTERS; i++) {
      ret = ret && this.word[i].equals(Field.zero);
    }
    return ret;
  }
  
  equal(othr: Word): Bool {
    // TODO: can we just compare arrays directly?
    let ret = new Bool(true);
    for (let i = 0; i < Word.N_LETTERS; i++) {
      ret = ret && this.word[i].equals(othr.word[i]);
    }
    return ret;
  }
}

export class Clues {
  static readonly N_CLUES = 6
  static readonly N_CLUE_LETTER_BITS = 2;

  // Values: 0 -> Grey, 1 -> Yellow, 2 -> Green
  clues = new Array<Field[]>(Clues.N_CLUES);

  constructor(serializedClues: Field) {
    let serializedCluesBits = serializedClues.toBits();
    for (let i = 0; i < Clues.N_CLUES; i++) {
      let offsetRow = i * Clues.N_CLUE_LETTER_BITS * Clues.N_CLUES;
      for (let j = 0; j < Word.N_LETTERS; j++) {
        let offsetVal = offsetRow + (j * Clues.N_CLUE_LETTER_BITS);
        this.clues[i].push(Field.ofBits([
                            serializedCluesBits[offsetVal],
                            serializedCluesBits[offsetVal + 1]
                           ]));
      }
    }
  }

  serialize(): Field {
    let cluesBits = [];
    for (let i = 0; i < Clues.N_CLUES; i++) {
      for (let j = 0; j < Word.N_LETTERS; j++) {
          let clueLetterBits = this.clues[i][j].toBits();
          for (let k = 0; k < Clues.N_CLUE_LETTER_BITS; k++) {
            cluesBits.push(clueLetterBits[k]);
          }
      }
    }
    return Field.ofBits(cluesBits);
  }

  update(solutionWord: Word, guessedWord: Word, nRow: Field) {
    let clue = new Array<Field>(Word.N_LETTERS);
    for (let i = 0; i < Word.N_LETTERS; i++) {
      for (let j = 0; j < Word.N_LETTERS; j++) {
        if (guessedWord.getChar(i) == solutionWord.getChar(j)) {
          // Mark yellow (1)
          clue[i] = new Field(1)
        }
      }
      
      if (guessedWord.getChar(i) == solutionWord.getChar(i)) {
        // Mark green (2) 
        clue[i] = new Field(2);
      }
    }

    this.clues[Number(nRow.toBigInt())] = clue;
  }
}
class WordleState extends CircuitValue {
  // Some random salt to prevent rainbow table of valid sultions.
  @prop commitSalt: Field;
  // Commit (poseidon hash) of the solution + the random salt.
  @prop solutionCommit: Field;

  // Current row.
  @prop nRow: Field;
  // Clues embeded in a single field elem (we need 6 x 5 x 2 = 60 bits).
  @prop clues: Clues;
  // True if it's the players turn to guess a word. If false it's the "houses" turn to evaluate guess.
  @prop playersTurn: Bool;
  // Defaults to false, set to true when the player wins.
  @prop gameFinished: Bool;
  // Last guessed word.
  @prop lastGuess: Word;

  constructor(
    commitSalt: Field,
    solutionCommit: Field,
    nRow: Field,
    clues: Clues,
    playersTurn: Bool,
    gameFinished: Bool,
    lastGuess: Word
  ) {
    super();
    this.commitSalt = commitSalt;
    this.solutionCommit = solutionCommit;
    this.nRow = nRow;
    this.clues = clues;
    this.playersTurn = playersTurn;
    this.gameFinished = gameFinished;
    this.lastGuess = lastGuess;
  }
}

let Wordle = ZkProgram({
  publicInput: WordleState,

  methonds: {
    init: { // Base case; This will commit the house to the valid solution.
            //            It cannot be changed after the init or else the recursive
            //            proof verification will fail.
      privateInputs: [Word],

      method(
        publicInput: WordleState,
        solution: Word
      ) {
        // TODO: Check that the solution is valid so the code generator can't create an
        // illegal game.
        
        publicInput.solutionCommit.assertEquals(solution.hash(publicInput.commitSalt));
        publicInput.nRow.assertEquals(Field.zero);
        publicInput.clues.serialize().assertEquals(Field.zero);
        publicInput.playersTurn.assertEquals(new Bool(false));
        publicInput.gameFinished.assertEquals(new Bool(false));
        publicInput.lastGuess.isNone().assertEquals(new Bool(true));
      }
    },

    updateHouse: {
      privateInputs: [Word, SelfProof],

      method(
        publicInput: WordleState,
        solution: Word,
        prevProof: SelfProof<WordleState>
      ) {
        prevProof.verify();

        // If the game is already finished, abort.
        const finished = prevProof.publicInput.gameFinished;
        finished.assertEquals(false);
        publicInput.gameFinished.assertEquals(false);

        // Check if it's the "houses" turn.
        const playersTurn = prevProof.publicInput.playersTurn;
        playersTurn.assertEquals(false);
        
        // Make sure to flip this flag in next turn.
        prevProof.publicInput.playersTurn.assertEquals(true);

        // Check if nRow + 1 > 5. If so finish game.
        let nRow = prevProof.publicInput.nRow;
        const nRowP1 = nRow.add(1);
        nRowP1.assertLte(5);
        publicInput.nRow.assertEquals(nRowP1);
        
        // Check validity of solution via commitment.
        solution.hash(prevProof.publicInput.commitSalt).assertEquals(prevProof.publicInput.solutionCommit);
        
        // Check if player guessed right word. If so finish game.
        let rightWord = prevProof.publicInput.lastGuess.equal(solution);
        publicInput.gameFinished.assertEquals(rightWord);

        // Update clues.
        let clues = prevProof.publicInput.clues;
        clues.update(solution, prevProof.publicInput.lastGuess, nRow);
        publicInput.clues.serialize().assertEquals(clues.serialize());
      }
    },

    updatePlayer: {
      privateInputs: [Word, SelfProof],

      method(
        publicInput: WordleState,
        guess: Word,
        prevProof: SelfProof<WordleState>
      ) {
        prevProof.verify();

        // If the game is already finished, abort.
        const finished = prevProof.publicInput.gameFinished;
        finished.assertEquals(false);
        publicInput.gameFinished.assertEquals(false);

        // Check if it's the players turn.
        const playersTurn = prevProof.publicInput.playersTurn;
        playersTurn.assertEquals(true);

        // Make sure to flip this flag in next turn.
        prevProof.publicInput.playersTurn.assertEquals(false);
        
        // Update lastGuess and stats.
        publicInput.lastGuess.serialize().assertEquals(guess.serialize());
        
        // Make sure to propagate other values from previous proof.
        publicInput.commitSalt.assertEquals(prevProof.publicInput.commitSalt);
        publicInput.solutionCommit.assertEquals(prevProof.publicInput.solutionCommit);
        publicInput.nRow.assertEquals(prevProof.publicInput.nRow);
        publicInput.clues.serialize().assertEquals(prevProof.publicInput.clues.serialize());
      }
    }
    
  }

})
