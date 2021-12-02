import test from 'tape';
import spok from 'spok';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  CreateMetadata,
  Edition,
  EditionData,
  Metadata,
  MetadataData,
  MetadataDataData,
} from '../';
import {
  TransactionHandler,
  connectionURL,
  airdrop,
  PayerTransactionHandler,
  defaultSendOptions,
} from './utils';
import { createMintAccount } from './utils/CreateMint';
import { assertConfirmedTransaction, assertTransactionSummary } from './utils/asserts';

import BN from 'bn.js';

import { logDebug } from './utils';
import { addLabel, isKeyOf } from './utils/address-labels';
import { MetadataKey } from 'src/MetadataProgram';

// -----------------
// Create Metadata
// -----------------
// src/actions/createMetadata.ts
type CreateMetadataParams = {
  transactionHandler: TransactionHandler;
  publicKey: PublicKey;
  editionMint: PublicKey;
  metadataData: MetadataDataData;
  updateAuthority?: PublicKey;
};

async function createMetadata({
  transactionHandler,
  publicKey,
  editionMint,
  metadataData,
  updateAuthority,
}: CreateMetadataParams) {
  const metadata = await Metadata.getPDA(editionMint);
  const createMetadataTx = new CreateMetadata(
    { feePayer: publicKey },
    {
      metadata,
      metadataData,
      updateAuthority: updateAuthority ?? publicKey,
      mint: editionMint,
      mintAuthority: publicKey,
    },
  );

  const createTxDetails = await transactionHandler.sendAndConfirmTransaction(
    createMetadataTx,
    [],
    defaultSendOptions,
  );

  return { metadata, createTxDetails };
}

const URI = 'uri';
const NAME = 'test';
const SYMBOL = 'sym';
const SELLER_FEE_BASIS_POINTS = 10;

test('create-metadata-account: success', async (t) => {
  const payer = Keypair.generate();
  addLabel('create:payer', payer);

  const connection = new Connection(connectionURL, 'confirmed');
  const transactionHandler = new PayerTransactionHandler(connection, payer);

  await airdrop(connection, payer.publicKey, 2);

  const { mint, createMintTx } = await createMintAccount(connection, payer.publicKey);
  const mintRes = await transactionHandler.sendAndConfirmTransaction(
    createMintTx,
    [mint],
    defaultSendOptions,
  );
  addLabel('create:mint', mint);

  assertConfirmedTransaction(t, mintRes.txConfirmed);

  const initMetadataData = new MetadataDataData({
    uri: URI,
    name: NAME,
    symbol: SYMBOL,
    sellerFeeBasisPoints: SELLER_FEE_BASIS_POINTS,
    creators: null,
  });

  const { createTxDetails, metadata } = await createMetadata({
    transactionHandler,
    publicKey: payer.publicKey,
    editionMint: mint.publicKey,
    metadataData: initMetadataData,
  });

  addLabel('create:metadata', metadata);
  logDebug(createTxDetails.txSummary.logMessages.join('\n'));

  assertTransactionSummary(t, createTxDetails.txSummary, {
    fee: 5000,
    msgRx: [/Program.+metaq/i, /Instruction.+ Create Metadata Accounts/i],
  });
  const metadataAccount = await connection.getAccountInfo(metadata);
  logDebug({
    metadataAccountOwner: metadataAccount.owner.toBase58(),
    metadataAccountDataBytes: metadataAccount.data.byteLength,
  });

  const metadataData = MetadataData.deserialize(metadataAccount.data);
  spok(t, metadataData, {
    $topic: 'metadataData',
    key: MetadataKey.MetadataV1,
    updateAuthority: isKeyOf(payer),
    mint: isKeyOf(mint),
    data: {
      name: NAME,
      symbol: SYMBOL,
      uri: URI,
      sellerFeeBasisPoints: SELLER_FEE_BASIS_POINTS,
    },
    primarySaleHappened: 0,
    isMutable: 1,
  });

  const mintAccount = await connection.getAccountInfo(mint.publicKey);
  logDebug({
    mintAccountOwner: mintAccount.owner.toBase58(),
    mintAccountDataBytes: mintAccount.data.byteLength,
  });

  t.ok(Edition.isCompatible(mintAccount.data), 'mint account data is mint edition');

  const editionData = EditionData.deserialize(mintAccount.data);
  const edition: BN = editionData.edition;
  t.ok(edition.toNumber() > 0, 'greater zero edition number');
});
