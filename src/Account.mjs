class Account {
    constructor(publicKey, privateKey, address) {
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.address = address;
        this.nonce = 0;
    }

    signTransaction(transaction) {
        transaction.sign(this.privateKey);
        return transaction;
    }
}

export default Account;
export { Account };