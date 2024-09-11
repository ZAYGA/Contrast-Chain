import { parentPort } from 'worker_threads';
import utils from '../src/utils.mjs';
import { HashFunctions } from '../src/conCrypto.mjs';

// just testing ES6 browser worker: 

// The miner worker is able to:
// mine POW of candidate blocks

parentPort.on('message', async (task) => {
	const id = task.id;
	const response = { id };
	const argon2Fnc = task.useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;
    switch (task.type) {
        case 'mine':
			try {
				const blockHash = await utils.mining.hashBlockSignature(argon2Fnc, task.signatureHex, task.nonce);
				if (!blockHash) { throw new Error('Invalid block hash'); }

				task.blockCandidate.hash = blockHash.hex;
				response.blockCandidate = task.blockCandidate;
				response.bitsArrayAsString = blockHash.bitsArray.join('');
			  } catch (err) {
				response.error = err.message;
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
