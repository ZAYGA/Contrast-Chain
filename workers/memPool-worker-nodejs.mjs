import { TxValidation } from "../src/validation.mjs";

// ABORTED FILE !

parentPort.on('message', async (task) => {
	const id = task.id;
	const response = { id };
	switch (task.type) {
		case 'determineTransactionMemPoolInclusion':
			try {
				const transaction = task.transaction;
				const useDevArgon2 = task.useDevArgon2;
				const utxosByAnchor = task.utxosByAnchor;

				// First control format of : amount, address, rule, version, TxID, available UTXOs
				TxValidation.isConformTransaction(utxosByAnchor, transaction, false);

				// Fourth validation: low computation cost.
				await TxValidation.controlTransactionOutputsRulesConditions(transaction);

				// Fifth validation: medium computation cost.
				await TxValidation.controlAllWitnessesSignatures(transaction);

				// Sixth validation: high computation cost.
				const witnessesPubKeysAddress = await TxValidation.addressOwnershipConfirmation(utxosByAnchor, transaction, useDevArgon2);

				response.transaction = transaction;
				response.pubKeysAddress = witnessesPubKeysAddress;

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