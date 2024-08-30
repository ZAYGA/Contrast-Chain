/*const { parentPort } = require('worker_threads');
const { CallStack } = require('./callstack.mjs');
const { Miner } = require('./miner.mjs');*/
import { parentPort } from 'worker_threads';
import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';

//const callStack = CallStack.buildNewStack([]);

// just testing ES6 browser worker: 

// The nodejs worker is able to:
// mine POW of candidate blocks
// treat a blockProposal from a miner.


parentPort.on('message', async (task) => {
	const id = task.id;
	const response = { id };
	const argon2Fnc = task.devmode ? HashFunctions.devArgon2 : HashFunctions.Argon2;
    switch (task.type) {
        case 'mine':
			try {
				const blockHash = await utils.mining.hashBlockSignature(argon2Fnc, task.signatureHex, task.nonce);
				if (!blockHash) { throw new Error('Invalid block hash'); }

				task.blockCandidate.hash = blockHash.hex;
				response.blockCandidate = task.blockCandidate;
				response.bitsArrayAsString = blockHash.bitsArray.join('')
			  } catch (err) {
				response.error = err.message;
				return;
			  }
            break;
		case 'terminate':
			parentPort.close(); // close the worker
			break;
        default:
			response.error = 'Invalid task type';
            break;
    }
	parentPort.postMessage(response);
});
