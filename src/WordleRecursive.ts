import {
  Field,
  Poseidon,
  Bool,
  Experimental,
  Proof,
  SmartContract,
  State,
  state,
  method,
  CircuitValue,
  prop,
  SelfProof,
  arrayProp,
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

export class Word extends CircuitValue {
  static readonly N_LETTERS = 5;
  static readonly N_LETTER_BITS = 5;

  @arrayProp(Field, Word.N_LETTERS) word: Field[];

  constructor(serializedWord: Field) {
    super();

    this.word = [];
    const wordBits = serializedWord.toBits();
    for (let i = 0; i < Word.N_LETTERS; i++) {
      let letterBits = [];
      for (let j = 0; j < Word.N_LETTER_BITS; j++) {
        letterBits.push(wordBits[i * Word.N_LETTER_BITS + j]);
      }
      this.word.push(Field.fromBits(letterBits)); 
    }
  }

  serialize(): Field {
    return Word.serializeRaw(this.word);
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
  
  compare(othr: Word): Bool {
    // TODO: Can we just compare arrays directly?
    let ret = new Bool(true);
    for (let i = 0; i < Word.N_LETTERS; i++) {
      ret = ret.and(this.word[i].equals(othr.word[i]));
    }
    return ret;
  }
  
  static fromRaw(word: Field[]): Word {
    return new Word(this.serializeRaw(word));
  }
  
  static serializeRaw(word: Field[]): Field {
    // TODO: Where to do these assertions?
    //if (word.length != Word.N_LETTERS) throw new Error("Word must be made up of 5 letters!");
    //for (let i = 0; i < Word.N_LETTERS; i++) {
    //  if (word[i].lt(0) || word[i].gt(25)) throw new Error("Invalid char at idx " + i.toString() + "!");
    //}
    let wordBits = [];
    for (let i = 0; i < Word.N_LETTERS; i++) {
      let letterBits = word[i].toBits();
      for (let j = 0; j < Word.N_LETTER_BITS; j++) {
        wordBits.push(letterBits[j]);
      }
    }
    return Field.fromBits(wordBits);
  }
}

export class Clues extends CircuitValue { // TODO: Circuit value could store only latest clue, not all. Like with Word.
  static readonly N_CLUES = 6
  static readonly N_CLUE_LETTER_BITS = 2;

  // Values: 0 -> Grey, 1 -> Yellow, 2 -> Green
  @arrayProp(Field, Clues.N_CLUES * Word.N_LETTERS) clues: Field[];

  constructor(serializedClues: Field) {
    super();

    this.clues = [];
    let serializedCluesBits = serializedClues.toBits();
    for (let i = 0; i < Clues.N_CLUES; i++) {
      let offsetRow = i * Clues.N_CLUE_LETTER_BITS * Clues.N_CLUES;
      for (let j = 0; j < Word.N_LETTERS; j++) {
        let offsetVal = offsetRow + (j * Clues.N_CLUE_LETTER_BITS);
        this.clues.push(Field.fromBits([
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
          let clueLetterBits = this.clues[i * Word.N_LETTERS + j].toBits();
          for (let k = 0; k < Clues.N_CLUE_LETTER_BITS; k++) {
            cluesBits.push(clueLetterBits[k]);
          }
      }
    }
    return Field.fromBits(cluesBits);
  }

  update(solutionWord: Word, guessedWord: Word, nRow: Field) {
    for (let nRowNum = 0; nRowNum < Clues.N_CLUES; nRowNum ++) {
      if (nRow.equals(nRowNum)) {
        for (let i = 0; i < Word.N_LETTERS; i++) {
          let val = new Field(0);

          for (let j = 0; j < Word.N_LETTERS; j++) {
            if (guessedWord.getChar(i) == solutionWord.getChar(j)) {
              // Mark yellow (1)
              val = new Field(1)
            }
          }
          
          if (guessedWord.getChar(i) == solutionWord.getChar(i)) {
            // Mark green (2) 
            val = new Field(2);
          }
          
          this.clues[nRowNum * Word.N_LETTERS + i] = val;
        }
      }
    }
  }

}

export class WordleState extends CircuitValue {
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

export { Wordle };

let Wordle = Experimental.ZkProgram({

  publicInput: WordleState,

  methods: {
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
        publicInput.playersTurn.assertEquals(new Bool(true));
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

        // Check if it's the "houses" turn.
        const playersTurn = prevProof.publicInput.playersTurn;
        playersTurn.assertEquals(false);
        
        // Make sure to flip this flag in next turn.
        publicInput.playersTurn.assertEquals(true);

        // Check if nRow + 1 > 5. If so finish game.
        let nRow = prevProof.publicInput.nRow;
        const nRowP1 = nRow.add(1);
        nRowP1.assertLte(5);
        publicInput.nRow.assertEquals(nRowP1);
        
        // Check validity of solution via commitment.
        solution.hash(prevProof.publicInput.commitSalt).assertEquals(prevProof.publicInput.solutionCommit);
        
        // Check if player guessed right word. If so finish game.
        let rightWord = prevProof.publicInput.lastGuess.compare(solution);
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
        publicInput.playersTurn.assertEquals(false);
        
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

// class that describes the rolled up proof
export class WordleProof extends Proof<WordleState> {
  static publicInputType = WordleState;
  static tag = () => Wordle;
}

export class WordleRollup extends SmartContract {
  @state(Bool) someoneWon = State<Bool>();

  @method publishCompletedGame(
    proof: WordleProof // <-- we're passing in a proof!
  ) {
    // verify the proof
    proof.verify();
    
    // check if game finished;
    proof.publicInput.gameFinished.assertEquals(true);

    // declare that someone won this game!
    this.someoneWon.set(Bool(true));
  }
}
