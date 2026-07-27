# Spring Boot 기반 mini-batch 실행 이력 로깅과 하트비트 패턴 적용하기

> Spring Batch 없이 K8s CronJob으로 배치를 돌리는 환경에서, INSERT-only 이벤트 로그와 하트비트 패턴으로 배치 실행 이력을 남기고 장애를 탐지하는 방법을 다룹니다.

---

## 배경 — 왜 배치 실행 로그가 필요한가

Spring Batch를 쓰면 `BATCH_JOB_EXECUTION`, `BATCH_STEP_EXECUTION` 같은 메타 테이블이 기본 제공된다. 하지만 우리 프로젝트는 Spring Batch 없이 `ApplicationRunner` + K8s CronJob으로 배치를 돌리고 있다.

이 구조에서는 배치가 "언제 시작했고, 성공했는지, 실패했는지, 얼마나 걸렸는지"를 별도로 기록하지 않으면 확인할 방법이 `kubectl logs`밖에 없다. 여기에 더해서:

- **배치가 중간에 죽으면?** OOM Kill이나 노드 장애로 프로세스가 통째로 날아가면 실패 로그조차 못 남긴다
- **배치가 평소보다 오래 걸리면?** 돌고 있는 건지 죽은 건지 구분이 안 된다
- **여러 배치가 동시에 돌면?** 각각의 실행 이력을 추적할 수 있어야 한다

이 문제를 **테이블 하나, INSERT-only 이벤트 로그, 하트비트 패턴** 세 가지 조합으로 해결했다.

---

## 설계 원칙

### 1. INSERT-only, UPDATE 없음

배치 시작 시 한 줄, 끝날 때 한 줄을 **각각 INSERT** 한다. 하나의 행을 시작할 때 INSERT하고 끝날 때 UPDATE하는 방식을 쓰지 않은 이유:

| 비교 | UPDATE 방식 | INSERT-only 방식 |
|------|-----------|-----------------|
| 트랜잭션 | 시작~종료까지 길게 열어야 함 (또는 별도 트랜잭션 관리) | 매 INSERT가 독립 트랜잭션, 짧게 끊김 |
| 동시 배치 | 여러 배치가 같은 행을 UPDATE할 일은 없지만, 트랜잭션이 길면 커넥션 점유 | 완전 독립, 서로 영향 없음 |
| 중간 사망 | UPDATE 못 하고 죽으면 `RUNNING` 상태로 영원히 남음 | 종료 행이 없는 것 자체가 "사망" 시그널 |

### 2. 하트비트 — 3분 간격 RUNNING INSERT

배치가 돌고 있는 동안 3분마다 `status = RUNNING` 행을 INSERT한다. 이게 왜 필요하냐면:

- **사망 탐지**: `STARTED` 행은 있는데 `SUCCESS`/`FAILURE` 행이 없고, 마지막 `RUNNING` 하트비트가 10분 이상 전이면 → "죽었다"
- **실시간 모니터링**: 마지막 하트비트의 `recorded_at`을 보면 배치가 살아있는지 즉시 확인 가능
- **소요 시간 추정**: 하트비트가 없으면 "1시간 전에 시작"만 알지, 지금 돌고 있는지 알 수 없음

### 3. 공통 처리 — 개별 배치는 수정 불필요

모든 로깅은 `BatchDispatcher`(배치 진입점)에서 처리한다. 새 배치를 추가할 때 `BatchJob.execute()`만 구현하면 되고, 실행 이력 로깅은 자동으로 적용된다.

---

## 구현

### 테이블 설계

테이블은 하나만 쓴다. 배치 하나의 생명주기 동안 여러 행이 같은 `execution_id`를 공유한다:

```sql
batch_execution_logs (
execution_id      VARCHAR(36)
job_name          VARCHAR(100)
status            VARCHAR(16)
recorded_at       TIMESTAMPTZ
batch_started_at  TIMESTAMPTZ
batch_finished_at TIMESTAMPTZ
error_message     VARCHAR(1000)
);
```

하나의 배치 실행에 대해 기록되는 행의 패턴:

| 시점 | status | batch_started_at | batch_finished_at | error_message |
|------|--------|------------------|-------------------|---------------|
| 배치 시작 | `STARTED` | 시작 시각 | null | null |
| 실행 중 (3분 간격) | `RUNNING` | 시작 시각 | null | null |
| 실행 중 (3분 간격) | `RUNNING` | 시작 시각 | null | null |
| … | … | … | … | … |
| 배치 종료 (성공) | `SUCCESS` | 시작 시각 | 종료 시각 | null |
| 배치 종료 (실패) | `FAILURE` | 시작 시각 | 종료 시각 | 예외 메시지 |

`recorded_at`은 행이 INSERT된 정확한 시각이고, `batch_started_at`은 배치가 시작된 시각을 모든 행이 공유한다. `recorded_at`은 `updatable = false`로 변경 불가 컬럼이다.

### 팩토리 메서드 패턴 사용으로 최적화

```kotlin
class `팩토리메서드패턴으로 로그 엔티티 구체화 하기`
    
) {
    companion object {
        fun started(executionId: String, jobName: String, startedAt: OffsetDateTime) =
            BatchExecutionLog(
                executionId = executionId,
                jobName = jobName,
                status = BatchStatus.STARTED,
                batchStartedAt = startedAt,
            )

        fun running(executionId: String, jobName: String, batchStartedAt: OffsetDateTime) =
            BatchExecutionLog(
                executionId = executionId,
                jobName = jobName,
                status = BatchStatus.RUNNING,
                batchStartedAt = batchStartedAt,
            )

        fun success(executionId: String, jobName: String, batchStartedAt: OffsetDateTime) =
            BatchExecutionLog(
                executionId = executionId,
                jobName = jobName,
                status = BatchStatus.SUCCESS,
                batchStartedAt = batchStartedAt,
                batchFinishedAt = OffsetDateTime.now(),
            )

        fun failure(executionId: String, jobName: String, batchStartedAt: OffsetDateTime, e: Exception) =
            BatchExecutionLog(
                executionId = executionId,
                jobName = jobName,
                status = BatchStatus.FAILURE,
                batchStartedAt = batchStartedAt,
                batchFinishedAt = OffsetDateTime.now(),
                errorMessage = buildErrorMessage(e),
            )

        private fun buildErrorMessage(e: Exception): String {
            val message = StringBuilder()
            message.append(e::class.simpleName).append(": ").append(e.message ?: "")
            e.stackTrace.take(10).forEach { frame ->
                message.append("\n  at ").append(frame)
            }
            return message.toString().take(1000)
        }
    }
}

```

포인트:
- **팩토리 메서드 패턴**: `started()`, `running()`, `success()`, `failure()` — 상태별 행 생성 로직을 한 곳에서 관리
- **`buildErrorMessage()`**: 예외 클래스명 + 메시지 + 스택트레이스 상위 10프레임을 1000자 내로 잘라서 저장. 디버깅에 충분한 정보를 남기면서 DB 부하를 억제
- **불변 엔티티**: setter 없이 생성 시 값이 확정. INSERT-only 설계와 궁합이 맞음

### BatchDispatcher — 진입점

```kotlin
[ START: 배치 디스패처 실행 ]
  │
  ├─▶ 1. 작업 식별
  │      - 환경변수나 인자에서 실행할 '배치명' 추출
  │      - (없거나 유효하지 않으면 예외 발생 후 즉시 종료)
  │
  ├─▶ 2. 작업 시작 처리
  │      - 고유 실행 ID(UUID) 발급
  │      - DB 기록: [상태 = STARTED]
  │
  ├─▶ 3. 하트비트 가동 (백그라운드)
  │      - 별도 스레드에서 3분마다 DB 기록: [상태 = RUNNING]
  │
  ├─▶ 4. 메인 작업 실행 ( job.execute() )
  │
  ├───▶ [ 정상 완료 (Try) ]
  │       ├─▶ 하트비트 중지
  │       ├─▶ DB 기록: [상태 = SUCCESS]
  │       └─▶ 프로세스 종료 (Exit 0)
  │
  └───▶ [ 에러 발생 (Catch) ]
          ├─▶ 하트비트 중지
          ├─▶ DB 기록: [상태 = FAILURE, 에러 정보]
          └─▶ 프로세스 종료 (Exit 1)
```

전체 흐름을 시퀀스 다이어그램으로 보면:

```
BatchDispatcher          DB (batch_execution_logs)       ScheduledExecutorService
     │                            │                              │
     │── INSERT STARTED ─────────►│                              │
     │                            │                              │
     │── startHeartbeat() ────────┼─────────────────────────────►│
     │                            │                              │
     │   job.execute() 시작       │                              │
     │   ...                      │   ◄── INSERT RUNNING (3분) ──│
     │   ...                      │   ◄── INSERT RUNNING (6분) ──│
     │   ...                      │   ◄── INSERT RUNNING (반복) ──│
     │   job.execute() 완료       │                              │
     │                            │                              │
     │── shutdown() ──────────────┼─────────────────────────────►│ (스케줄러 종료)
     │                            │                              │
     │── INSERT SUCCESS ─────────►│                              │
     │                            │                              │
     │── System.exit(0)           │                              │
```

### 하트비트 구현 세부

```kotlin
private fun startHeartbeat(
    executionId: String,
    jobName: String,
    batchStartedAt: OffsetDateTime,
): ScheduledExecutorService {
    val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "batch-heartbeat-$jobName").apply { isDaemon = true }
    }
    scheduler.scheduleAtFixedRate(
        {
            try {
                executionLogRepository.save(
                    BatchExecutionLog.running(executionId, jobName, batchStartedAt)
                )
            } catch (e: Exception) {
                logger.warn("[BATCH] ── $jobName 하트비트 기록 실패 ──", e)
            }
        },
        HEARTBEAT_INTERVAL_MINUTES,  // initialDelay = 3분
        HEARTBEAT_INTERVAL_MINUTES,  // period = 3분
        TimeUnit.MINUTES,
    )
    return scheduler
}
```

설계 결정 포인트:

| 항목 | 결정 | 이유 |
|------|------|------|
| 스레드 방식 | `ScheduledExecutorService` | 코루틴보다 단순하고, Spring 의존 없이 JDK만으로 동작 |
| 데몬 스레드 | `isDaemon = true` | 메인 스레드가 죽으면 하트비트 스레드도 같이 죽어야 함 |
| initialDelay | 3분 | 시작 직후에는 `STARTED` 행이 있으니까 즉시 찍을 필요 없음 |
| 예외 처리 | try-catch로 감싸고 warn 로그만 | 하트비트 실패가 배치 본체를 죽이면 안 됨 |
| 종료 | `heartbeat.shutdown()` | try/catch 양쪽에서 모두 호출. SUCCESS/FAILURE INSERT 전에 정리 |

### 왜 코루틴이 아닌가?

`delay()`를 쓰는 코루틴 방식도 가능하지만:

- `BatchDispatcher`는 `ApplicationRunner.run()`이라 suspend 함수가 아님
- 코루틴 스코프를 별도로 만들어야 하고, 취소 처리도 필요
- `ScheduledExecutorService`는 5줄이면 끝나고 JDK 기본 제공
- 복잡도 대비 이득도 없고 `ScheduledExecutorService`를 선택했다.
- 자바를 써도 변환만 해서 그대로 사용가능하고, JDK23 이후 버전에서는 코루틴을 굳이 써야할까 싶다(그냥 버추얼쓰래드를 사용하자)

---

## 활용 — 모니터링 쿼리

- 최근 배치 실행 현황은 execution_id 기준으로 LEFT JOIN 으로 쉽게 구할 수 있다
  - `STARTED` 행을 기준으로 잡고, 같은 `execution_id`의 종료 행을 LEFT JOIN한다. 종료 행이 없으면 아직 돌고 있거나 죽은 것.
- 중간에 죽은 배치도탐지 해 낼 수 있다
```
핵심 로직:
1. `STARTED`는 있는데 `SUCCESS`/`FAILURE`가 없으면 → 아직 끝나지 않은 배치
2. 거기서 마지막 `RUNNING` 하트비트가 10분 이상 전이면 → 죽었을 가능성 높음
3. 하트비트가 아예 없는 것도(`r.recorded_at IS NULL`) 포함 — 시작 직후 죽은 경우
```
- 10분 임계치는 하트비트 주기(3분)의 3배 + 여유분. 환경에 따라 조정가능

---

## 행 증가량과 정리 정책

하트비트를 3분마다 찍으면 행이 쌓인다. 얼마나?

| 배치 소요 시간 | 하트비트 행 수 | 총 행 수 (시작+하트비트+종료) |
|--------------|-------------|-------------------------|
| 1분 | 0 | 2 (STARTED + SUCCESS) |
| 10분 | 3 | 5 |
| 30분 | 9 | 11 |
| 1시간 | 19 | 21 |

하루에 배치 1개가 10분씩 돈다면 하루 5행, 한 달 150행, 1년 1,800행. 문제될 양은 전혀 아님

배치가 여러 개이거나 장기 실행이 잦다면, 오래된 `RUNNING` 행을 주기적으로 정리하는 것도 고려할 수 있다:

---

## 개별 배치에서 해야 할 것

**없다.** 이게 이 설계의 장점이다.

새 배치를 추가할 때:

```kotlin
@Component("my-new-batch")
@Profile("batch")
class MyNewBatchJob(
    private val someService: SomeService,
) : BatchJob {
    override fun execute() {
        someService.doSomething()
    }
}
```

`BatchJob` 인터페이스의 `execute()`만 구현하면 된다. 실행 이력 로깅, 하트비트, 예외 처리, 프로세스 종료 — 전부 `BatchDispatcher`가 공통으로 처리한다.

---

## 한계와 트레이드오프

솔직하게 정리하면:

| 항목 | 현재 한계 | Spring Batch라면 |
|------|---------|----------------|
| 실패 지점 재시작 | ❌ 처음부터 다시 | ✅ 마지막 성공 청크부터 |
| Step별 이력 | ❌ 배치 단위만 | ✅ Step/Chunk 단위 |
| 하트비트 정확도 | 3분 단위 (그 사이에 죽으면 모름) | N/A (다른 방식으로 모니터링) |
| 관리 UI | ❌ SQL 직접 쿼리 | ✅ Spring Batch Admin |

하지만 우리 배치는:
- 실행 시간이 수 분 이내
- 실패하면 처음부터 다시 돌려도 됨 (멱등)
- 배치 수가 1~5개 수준

이 규모에서 Spring Batch 메타 테이블 5개 + 설정 클래스를 도입하는 건 오버엔지니어링이다.
INSERT-only 로그 테이블 하나와 하트비트로 충분할때 적용하면 좋음

---

## 정리

| 구성 요소 | 역할 |
|---------|------|
| `batch_execution_logs` 테이블 | 단일 테이블에 모든 배치의 생명주기를 기록 |
| `BatchExecutionLog` 엔티티 | 팩토리 메서드로 상태별 행 생성 (`started`, `running`, `success`, `failure`) |
| `BatchDispatcher` | 배치 진입점에서 로깅 + 하트비트를 공통 처리. 개별 배치는 수정 불필요 |
| INSERT-only 설계 | 트랜잭션 짧게, 동시 실행 안전, 중간 사망 시에도 데이터 유실 없음 |
| 하트비트 패턴 | 3분 간격 `RUNNING` INSERT로 생존 확인 + 사망 탐지 + 실시간 모니터링 |

Spring Batch가 제공하는 것의 5%도 안 되는 기능이지만, 그 5%가 실무에서 실제로 필요한 거의 전부다.
