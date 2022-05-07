import { Pool } from "pg";

declare global {
  interface Array<T> {
    groupBy(groupSelector: (item: T) => string|number|null|undefined): { [group: string]: T[] };
    toLookup(keySelector: (item: T) => string): { [key: string]: boolean };
    toLookup<TValue>(keySelector: (item: T) => string|number|null|undefined, valueSelector?: (item: T) => TValue): { [key: string]: TValue };
  }
}

Array.prototype.groupBy = function groupBy<T>(groupSelector: (item: T) => string): { [group: string]: T[] } {
  return (<T[]>this).reduce((p, c) => {
    const group = groupSelector(c);
    if (group === undefined || group === null) {
      return p;
    }
    if (!p[group]) {
      p[group] = [];
    }
    p[group].push(c);
    return p;
  }, <{ [group: string]: T[] }>{});
}

Array.prototype.toLookup = function toLookup<T, TValue>(keySelector: (item: T) => string, valueSelector?: (item: T) => TValue): { [key: string]: TValue } {
  return this.reduce((p, c) => {
    const key = keySelector(c);
    if (key === undefined || key === null) {
      return p;
    }
    p[key] = !valueSelector ? true : valueSelector(c);
    return p;
  }, <{ [key: string]: TValue }>{});
}

type ExportRelation = {
  "limit": null,
  "limitPercentage": string,
  "canSendToAddress": string,
  "userAddress": string
};

type ExportBalance = {
  amount: string,
  token: {
    id: string,
    owner: {
      id: string
    }
  }
};

type ExportSafe = {
  id: string,
  organization: boolean,
  outgoing: ExportRelation[],
  incoming: ExportRelation[],
  balances: ExportBalance[]
}

type SignupRow = {
  safe_address: string,
  is_orga: boolean
}

type TrustRelationRow = {
  is_identity: boolean,
  canSendToAddress: string,
  userAddress: string,
  limit: number
}

type BalanceRow = {
  safe_address: string,
  token: string,
  token_owner: string,
  amount: string
}

async function exportGraphAndBalances(connectionString:string) {
  const _indexDb: Pool = new Pool({
    connectionString: connectionString,
    ssl: !process.env.DEBUG,
  }).on("error", (err) => {
    console.error("An idle client has experienced an error", err.stack);
  });

  const blockQuery = `
  select max(number) as block from block;
`;
  const allSignupsQuery = `
  select s."user" as safe_address
       , s.token is null as is_orga
  from crc_all_signups s;
`;
  const incomingTrustsQuery = `
    select s."user" = tc."user" as is_identity
         , s."user" as "canSendToAddress"
         , tc."user" as "userAddress"
         , tc."limit"
    from crc_all_signups s
             join cache_crc_current_trust tc on tc."can_send_to" = s."user";
`;
  const outgoingTrustsQuery = `
    select s."user" = tc."can_send_to" as is_identity
         , tc."can_send_to" as "canSendToAddress"
         , tc."user" as "userAddress"
         , tc."limit"
    from crc_all_signups s
             join cache_crc_current_trust tc on tc."user" = s."user";
`;
  const allBalancesQuery = `
  select s."user" as safe_address
       , b.token
       , b.token_owner
       , b.balance as amount
  from crc_all_signups s
  join cache_crc_balances_by_safe_and_token b on b.safe_address = s."user";
`;

  const blockQueryP = _indexDb.query(blockQuery);
  const allSignupsQueryP = _indexDb.query(allSignupsQuery);
  const incomingTrustsQueryP = _indexDb.query(incomingTrustsQuery);
  const outgoingTrustsQueryP = _indexDb.query(outgoingTrustsQuery);
  const allBalancesQueryP = _indexDb.query(allBalancesQuery);

  // process.stderr.write("Querying the database ...");
  const results = await Promise.all([
    blockQueryP,
    allSignupsQueryP,
    incomingTrustsQueryP,
    outgoingTrustsQueryP,
    allBalancesQueryP
  ]);

  const lastBlock = results[0].rows[0].block;
  // process.stderr.write("last imported block:", lastBlock);

  const allSafes = results[1].rows.toLookup((o:SignupRow) => o.safe_address, (o:any) => o.is_orga);
  // process.stderr.write(`Got ${Object.keys(allSafes).length} safes.`);

  const incomingTrust = results[2].rows.groupBy((o:TrustRelationRow) => o.canSendToAddress);
  // process.stderr.write(`Got incoming trusts for ${Object.keys(incomingTrust).length} safes.`);

  const outgoingTrust = results[3].rows.groupBy((o:TrustRelationRow) => o.userAddress);
  // process.stderr.write(`Got outgoing trusts for ${Object.keys(outgoingTrust).length} safes.`);

  const allBalances = results[4].rows.groupBy((o:BalanceRow) => o.safe_address);
  // process.stderr.write(`Got balances for ${Object.keys(allBalances).length} safes.`);

  const safes:ExportSafe[] = [];

  for (const [safe_address, is_orga] of Object.entries(allSafes)) {
    if (safes.length % 10000 == 0) {
      // process.stderr.write(`Constructed ${safes.length} safe objects.`);
    }

    const outgoingTrusts = outgoingTrust[safe_address] ?? [];
    const incomingTrusts = incomingTrust[safe_address] ?? [];
    const balances = allBalances[safe_address] ?? [];

    const negativeBalances = balances.filter(o => o.amount.startsWith("-"));
    if (negativeBalances.length) {
      console.log("Bäh:", negativeBalances);
    }

    const nSafe:ExportSafe = {
      id: safe_address,
      organization: <boolean>is_orga,
      outgoing: outgoingTrusts.map((o:TrustRelationRow) => {
        return <ExportRelation>{
          canSendToAddress: o.canSendToAddress,
          userAddress: o.userAddress,
          limit: null,
          limitPercentage: o.limit.toString()
        }
      }),
      incoming: incomingTrusts.map((o:TrustRelationRow) => {
        return <ExportRelation>{
          canSendToAddress: o.canSendToAddress,
          userAddress: o.userAddress,
          limit: null,
          limitPercentage: o.limit.toString()
        }
      }),
      balances: balances.map((o: BalanceRow) => {
        return <ExportBalance> {
          token: {
            id: o.token,
            owner: {
              id: o.token_owner
            }
          },
          amount: o.amount
        }
      })
    };
    safes.push(nSafe);
  }

  const result = {
    blockNumber: lastBlock,
    safes: safes
  };

  return JSON.stringify(result);
}

// process.stderr.write("Starting the export ...");
const connectionString = process.argv[2] ? process.argv[2] : process.env.BLOCKCHAIN_INDEX_DB_CONNECTION_STRING;
if (!connectionString) {
  throw new Error(`No connection string`);
}

exportGraphAndBalances(connectionString)
.then(json => {
  process.stdout.write(json);
});