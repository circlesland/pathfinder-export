## Summary
Performs the equivalent of the following [theGraph](https://thegraph.com/hosted-service/subgraph/circlesubi/circles) 
query on the [indexer db](https://github.com/circlesland/blockchain-indexer) 
and exports the results to a json file that can be used with the [pathfinder](https://github.com/chriseth/pathfinder).
```graphql
query { 
    safes {
        id
        organization
        outgoing { 
            limit 
            limitPercentage 
            canSendToAddress 
            userAddress 
        }
        incoming { 
            limit 
            limitPercentage 
            canSendToAddress 
            userAddress 
        }
        balances {
            amount
            token {
                id
                owner {
                    id
                }
            }
        }
    }
}
```
## Usage
1. __Build the script__
    ```shell
   ./build.sh
   ```
2. __Run the script__
    ```shell
    DEBUG=true node dist/main.js postgresql://postgres:postgres@localhost:5432/indexer > dump.json
    ```
    Alternatively you can set the BLOCKCHAIN_INDEX_DB_CONNECTION_STRING environment variable. Remove DEBUG=true to force TLS connections.
3. __Convert to a pathfinder-db__
   ```shell
   ./pathfinder --importDB dump.json safes.db.dat
   ```