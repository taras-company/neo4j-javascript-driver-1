/**
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Notification } from 'rxjs'
import {
  mergeMap,
  materialize,
  toArray,
  map,
  concatWith
} from 'rxjs/operators'
import neo4j from '../../src'
// eslint-disable-next-line no-unused-vars
import RxSession from '../../src/session-rx'
import RxTransaction from '../../src/transaction-rx'
import sharedNeo4j from '../internal/shared-neo4j'
import { newError } from 'neo4j-driver-core'

describe('#integration-rx transaction', () => {
  let driver
  /** @type {RxSession} */
  let session
  /** @type {number} */
  let protocolVersion

  beforeEach(async () => {
    driver = neo4j.driver(
      `bolt://${sharedNeo4j.hostname}`,
      sharedNeo4j.authToken
    )
    session = driver.rxSession()

    protocolVersion = await sharedNeo4j.cleanupAndGetProtocolVersion(driver)
  })

  afterEach(async () => {
    if (session) {
      await session.close().toPromise()
    }
    await driver.close()
  })

  it('should commit an empty transaction', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const result = await session
      .beginTransaction()
      .pipe(
        mergeMap(txc => txc.commit()),
        materialize(),
        toArray()
      )
      .toPromise()

    expect(result).toEqual([Notification.createComplete()])
  })

  it('should rollback an empty transaction', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const result = await session
      .beginTransaction()
      .pipe(
        mergeMap(txc => txc.rollback()),
        materialize(),
        toArray()
      )
      .toPromise()

    expect(result).toEqual([Notification.createComplete()])
  })

  it('should run query and commit', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const result = await session
      .beginTransaction()
      .pipe(
        mergeMap(txc =>
          txc
            .run('CREATE (n:Node {id: 42}) RETURN n')
            .records()
            .pipe(
              map(r => r.get('n').properties.id),
              concatWith(txc.commit())
            )
        ),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(neo4j.int(42)),
      Notification.createComplete()
    ])

    expect(await countNodes(42)).toBe(1)
  })

  it('should run query and rollback', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const result = await session
      .beginTransaction()
      .pipe(
        mergeMap(txc =>
          txc
            .run('CREATE (n:Node {id: 42}) RETURN n')
            .records()
            .pipe(
              map(r => r.get('n').properties.id),
              concatWith(txc.rollback())
            )
        ),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(neo4j.int(42)),
      Notification.createComplete()
    ])

    expect(await countNodes(42)).toBe(0)
  })

  it('should run query and close', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const result = await session
      .beginTransaction()
      .pipe(
        mergeMap(txc =>
          txc
            .run('CREATE (n:Node {id: 42}) RETURN n')
            .records()
            .pipe(
              map(r => r.get('n').properties.id),
              concatWith(txc.close())
            )
        ),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(neo4j.int(42)),
      Notification.createComplete()
    ])

    expect(await countNodes(42)).toBe(0)
  })

  it('should run multiple queries and commit', async () => {
    await verifyCanRunMultipleQueries(true)
  })

  it('should run multiple queries and rollback', async () => {
    await verifyCanRunMultipleQueries(false)
  })

  it('should run multiple queries without waiting and commit', async () => {
    await verifyCanRunMultipleQueriesWithoutWaiting(true)
  })

  it('should run multiple queries without waiting and rollback', async () => {
    await verifyCanRunMultipleQueriesWithoutWaiting(false)
  })

  it('should run multiple queries without streaming and commit', async () => {
    await verifyCanRunMultipleQueriesWithoutStreaming(true)
  })

  it('should run multiple queries without streaming and rollback', async () => {
    await verifyCanRunMultipleQueriesWithoutStreaming(false)
  })

  it('should fail to commit after a failed query', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyFailsWithWrongQuery(txc)

    const result = await txc
      .commit()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot commit this transaction, because .* of an error/
          )
        })
      )
    ])
  })

  it('should succeed to rollback after a failed query', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyFailsWithWrongQuery(txc)

    const result = await txc
      .rollback()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([Notification.createComplete()])
  })

  it('should fail to commit after successful and failed query', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyCanCreateNode(txc, 5)
    await verifyCanReturnOne(txc)
    await verifyFailsWithWrongQuery(txc)

    const result = await txc
      .commit()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot commit this transaction, because .* of an error/
          )
        })
      )
    ])
  })

  it('should succeed to rollback after successful and failed query', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyCanCreateNode(txc, 5)
    await verifyCanReturnOne(txc)
    await verifyFailsWithWrongQuery(txc)

    const result = await txc
      .rollback()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([Notification.createComplete()])
  })

  it('should fail to run another query after a failed one', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyFailsWithWrongQuery(txc)

    const result = await txc
      .run('CREATE ()')
      .records()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot run query in this transaction, because .* of an error/
          )
        })
      )
    ])
  })

  it('should not allow commit after commit', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyCanCreateNode(txc, 6)
    await verifyCanCommit(txc)

    const result = await txc
      .commit()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot commit this transaction, because .* committed/
          )
        })
      )
    ])
  })

  it('should not allow rollback after rollback', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyCanCreateNode(txc, 6)
    await verifyCanRollback(txc)

    const result = await txc
      .rollback()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot rollback this transaction, because .* rolled back/
          )
        })
      )
    ])
  })

  it('should fail to rollback after commit', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyCanCreateNode(txc, 6)
    await verifyCanCommit(txc)

    const result = await txc
      .rollback()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot rollback this transaction, because .* committed/
          )
        })
      )
    ])
  })

  it('should fail to commit after rollback', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await verifyCanCreateNode(txc, 6)
    await verifyCanRollback(txc)

    const result = await txc
      .commit()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot commit this transaction, because .* rolled back/
          )
        })
      )
    ])
  })

  it('should fail to run query after committed transaction', async () => {
    await verifyFailToRunQueryAfterTxcIsComplete(true)
  })

  it('should fail to run query after rolled back transaction', async () => {
    await verifyFailToRunQueryAfterTxcIsComplete(false)
  })

  it('should update bookmarks', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const bookmarks0 = session.lastBookmarks()

    const txc1 = await session.beginTransaction().toPromise()
    await verifyCanCreateNode(txc1, 20)
    await verifyCanCommit(txc1)
    const bookmarks1 = session.lastBookmarks()

    const txc2 = await session.beginTransaction().toPromise()
    await verifyCanCreateNode(txc2, 21)
    await verifyCanCommit(txc2)
    const bookmarks2 = session.lastBookmarks()

    expect(bookmarks0).toEqual([])
    expect(bookmarks1).toBeTruthy()
    expect(bookmarks1).not.toEqual(bookmarks0)
    expect(bookmarks2).toBeTruthy()
    expect(bookmarks2).not.toEqual(bookmarks1)
  })

  it('should propagate failures from queries', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    const result1 = txc.run('CREATE (:TestNode) RETURN 1 AS n')
    const result2 = txc.run('CREATE (:TestNode) RETURN 2 AS n')
    const result3 = txc.run('RETURN 10 / 0 AS n')
    const result4 = txc.run('CREATE (:TestNode) RETURN 3 AS n')

    const result = await result1
      .records()
      .pipe(
        concatWith(result2.records()),
        concatWith(result3.records()),
        concatWith(result4.records()),
        map(r => r.get(0).toInt()),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(1),
      Notification.createNext(2),
      Notification.createError(newError('/ by zero'))
    ])

    await verifyCanRollback(txc)
  })

  it('should not run until subscribed', async () => {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    const result1 = txc.run('RETURN 1')
    const result2 = txc.run('RETURN 2')
    const result3 = txc.run('RETURN 3')
    const result4 = txc.run('RETURN 4')

    const result = await result4
      .records()
      .pipe(
        concatWith(result3.records()),
        concatWith(result2.records()),
        concatWith(result1.records()),
        map(r => r.get(0).toInt()),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(4),
      Notification.createNext(3),
      Notification.createNext(2),
      Notification.createNext(1),
      Notification.createComplete()
    ])

    await verifyCanCommit(txc)
  })

  it('should not propagate failure on commit if not executed', async () => {
    await verifyNoFailureIfNotExecuted(true)
  })

  it('should not propagate failure on rollback if not executed', async () => {
    await verifyNoFailureIfNotExecuted(false)
  })

  it('should not propagate run failure from summary', async () => {
    pending('behaviour difference across drivers')

    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()
    const result = txc.run('RETURN Wrong')

    const messages = await result
      .records()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(messages).toEqual([
      Notification.createError(
        jasmine.stringMatching(/Variable `Wrong` not defined/)
      )
    ])

    const summary = await result.consume().toPromise()
    expect(summary).toBeTruthy()
  })

  async function verifyNoFailureIfNotExecuted (commit) {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    txc.run('RETURN ILLEGAL')

    await verifyCanCommitOrRollback(txc, commit)
  }

  async function verifyFailToRunQueryAfterTxcIsComplete (commit) {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()
    await verifyCanCreateNode(txc, 15)
    await verifyCanCommitOrRollback(txc, commit)

    const result = await txc
      .run('CREATE ()')
      .records()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            /Cannot run query in this transaction, because/
          )
        })
      )
    ])
  }

  async function verifyCanRunMultipleQueries (commit) {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    await txc
      .run('CREATE (n:Node {id: 1})')
      .consume()
      .toPromise()
    await txc
      .run('CREATE (n:Node {id: 2})')
      .consume()
      .toPromise()
    await txc
      .run('CREATE (n:Node {id: 1})')
      .consume()
      .toPromise()

    await verifyCanCommitOrRollback(txc, commit)
    await verifyCommittedOrRollbacked(commit)
  }

  async function verifyCanRunMultipleQueriesWithoutWaiting (commit) {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    const result1 = txc.run('CREATE (n:Node {id: 1})')
    const result2 = txc.run('CREATE (n:Node {id: 2})')
    const result3 = txc.run('CREATE (n:Node {id: 1})')

    const results = await result1
      .records()
      .pipe(
        concatWith(result2.records()),
        concatWith(result3.records()),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(results).toEqual([Notification.createComplete()])

    await verifyCanCommitOrRollback(txc, commit)
    await verifyCommittedOrRollbacked(commit)
  }

  async function verifyCanRunMultipleQueriesWithoutStreaming (commit) {
    if (protocolVersion < 4.0) {
      return
    }

    const txc = await session.beginTransaction().toPromise()

    const result1 = txc.run('CREATE (n:Node {id: 1})')
    const result2 = txc.run('CREATE (n:Node {id: 2})')
    const result3 = txc.run('CREATE (n:Node {id: 1})')

    const results = await result1
      .keys()
      .pipe(
        concatWith(result2.keys()),
        concatWith(result3.keys()),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(results).toEqual([
      Notification.createNext([]),
      Notification.createNext([]),
      Notification.createNext([]),
      Notification.createComplete()
    ])

    await verifyCanCommitOrRollback(txc, commit)
    await verifyCommittedOrRollbacked(commit)
  }

  async function verifyCanCommit (txc) {
    const result = await txc
      .commit()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([Notification.createComplete()])
  }

  async function verifyCanRollback (txc) {
    const result = await txc
      .rollback()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([Notification.createComplete()])
  }

  async function verifyCanCommitOrRollback (txc, commit) {
    if (commit) {
      await verifyCanCommit(txc)
    } else {
      await verifyCanRollback(txc)
    }
  }

  async function verifyCanCreateNode (txc, id) {
    const result = await txc
      .run('CREATE (n:Node {id: $id}) RETURN n', { id: neo4j.int(id) })
      .records()
      .pipe(
        map(r => r.get('n').properties.id),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(neo4j.int(id)),
      Notification.createComplete()
    ])
  }

  async function verifyCanReturnOne (txc) {
    const result = await txc
      .run('RETURN 1')
      .records()
      .pipe(
        map(r => r.get(0)),
        materialize(),
        toArray()
      )
      .toPromise()
    expect(result).toEqual([
      Notification.createNext(neo4j.int(1)),
      Notification.createComplete()
    ])
  }

  async function verifyFailsWithWrongQuery (txc) {
    const result = await txc
      .run('RETURN')
      .records()
      .pipe(materialize(), toArray())
      .toPromise()
    expect(result).toEqual([
      Notification.createError(
        jasmine.stringMatching(/Unexpected end of input|Invalid input/)
      )
    ])
  }

  async function verifyCommittedOrRollbacked (commit) {
    if (commit) {
      expect(await countNodes(1)).toBe(2)
      expect(await countNodes(2)).toBe(1)
    } else {
      expect(await countNodes(1)).toBe(0)
      expect(await countNodes(2)).toBe(0)
    }
  }

  async function countNodes (id) {
    const session = driver.rxSession()
    return await session
      .run('MATCH (n:Node {id: $id}) RETURN count(n)', { id: id })
      .records()
      .pipe(
        map(r => r.get(0).toInt()),
        concatWith(session.close())
      )
      .toPromise()
  }
})

describe('#unit', () => {
  describe('.close()', () => {
    it('should delegate to the original Transaction', async () => {
      const txc = {
        close: jasmine.createSpy('close').and.returnValue(Promise.resolve())
      }

      const transaction = new RxTransaction(txc)

      await transaction.close().toPromise()

      expect(txc.close).toHaveBeenCalled()
    })

    it('should fail if to the original Transaction.close call fails', async () => {
      const expectedError = new Error('expected')
      const txc = {
        close: jasmine
          .createSpy('close')
          .and.returnValue(Promise.reject(expectedError))
      }

      const transaction = new RxTransaction(txc)

      try {
        await transaction.close().toPromise()
        fail('should have thrown')
      } catch (error) {
        expect(error).toBe(expectedError)
      }
    })
  })
})
