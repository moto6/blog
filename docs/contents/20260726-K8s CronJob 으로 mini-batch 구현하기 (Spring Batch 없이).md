# K8s CronJob 으로 mini-batch 구현하기 (Spring Batch 없이)

> 정기적으로 도는 단순한 배치(eg. 매일 1회)를 Spring Boot + Kubernetes 환경에서 가장 심플하게 구현하는 방법을 다룹니다

---

## 1. 배경과 문제 정의

프로젝트에서 매일 자정에 전체 사용자의 캘린더 일정을 외부 API 에서 조회해 DB 에 적재하는
일배치가 필요했다. 기존에는 `@Scheduled` 어노테이션으로 웹 서버 프로세스 안에서 스케줄링했지만,
다음 문제가 있었다:

- **웹 서버가 재시작되면** 스케줄이 유실될 수 있음
- **다중 Pod 환경**에서 중복 실행 방지를 별도로 구현해야 함
- **배치 실패 시** 재시도/알림이 애플리케이션 레벨에서 필요

Kubernetes CronJob 을 활용하면 이 문제들을 **인프라 레벨에서 해결**할 수 있다.

---

## 2. 아키텍처 개요

```txt
┌─────────────────────────────────────────────────────────┐
│  K8s Cluster                                            │
│                                                         │
│  ┌──────────────────┐      ┌──────────────────────┐     │
│  │  Deployment       │      │  CronJob             │     │
│  │  (웹 서버)         │      │  (배치)               │     │
│  │                   │      │                      │     │
│  │  Profile:         │      │  Profile:            │     │
│  │  prod             │      │  prod,batch          │     │
│  │                   │      │                      │     │
│  │  동일 이미지        │◄────►│  동일 이미지            │     │
│  │  place:v1.2       │      │  place:v1.2          │     │
│  └────────┬──────────┘      └──────────┬───────────┘     │
│           │                            │                │
│           └──────────┬─────────────────┘                │
│                      ▼                                  │
│              ┌──────────────┐                           │
│              │  PostgreSQL  │                           │
│              └──────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **동일 이미지** | 웹 서버와 배치가 같은 Docker 이미지를 사용한다. 버전 불일치 원천 차단. |
| **Profile 분리** | `batch` 프로파일 하나로 웹/배치 모드를 전환한다. |
| **환경변수 최소화** | 배치 전용 환경변수는 `BATCH_JOB_NAME` 하나뿐. 나머지는 기존 프로파일 재사용. |

---

## 3. 웹 서버 모드 vs 배치 모드 — 분리 지점

단일 모듈에서 두 모드를 명확히 분리하기 위해 **세 가지 레이어**에서 차단한다:

### 3-1. Spring Profile 레이어

```
┌────────────────────────────────────────────────────────────────┐
│  batch 프로파일 OFF (웹 서버 모드)                                │
│                                                                │
│  ✅ SchedulingConfig (@EnableScheduling)                       │
│  ✅ DailyScheduleSyncScheduler (@Scheduled)                    │
│  ✅ 웹 MVC 컨트롤러, 필터, 인터셉터                                │
│  ❌ BatchDispatcher (ApplicationRunner)                        │
│  ❌ DailyScheduleSyncJob (BatchJob)                            │
├────────────────────────────────────────────────────────────────┤
│  batch 프로파일 ON (배치 모드)                                   │
│                                                                │
│  ❌ SchedulingConfig                                           │
│  ❌ DailyScheduleSyncScheduler                                 │
│  ❌ 웹 MVC (web-application-type: none)                        │
│  ✅ BatchDispatcher (ApplicationRunner)                        │
│  ✅ DailyScheduleSyncJob (BatchJob)                            │
└────────────────────────────────────────────────────────────────┘
```

### 3-2. 실행 명령어 비교

동일한 Docker 이미지, 동일한 `ENTRYPOINT` 에서 **환경변수만으로** 모드가 갈린다.

#### Dockerfile ENTRYPOINT (공통)

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar ${app}.jar"]
```

> 이미지에는 프로파일을 굽지 않는다. 실행 시 `SPRING_PROFILES_ACTIVE` 환경변수로만 선택한다.

#### 웹 서버 모드

```bash
# K8s Deployment (또는 docker run)
SPRING_PROFILES_ACTIVE=prod  java -jar place.jar
```

- 내장 톰캣이 8080 포트로 기동
- `@EnableScheduling` + `@Scheduled` 가 활성화되어 인-프로세스 스케줄링 동작

#### 배치 모드

```bash
# K8s CronJob (또는 docker run)
SPRING_PROFILES_ACTIVE=prod,batch  BATCH_JOB_NAME=daily-schedule-sync  java -jar place.jar
```

| 환경변수 | 역할 |
|---------|------|
| `SPRING_PROFILES_ACTIVE=prod,batch` | `application-prod.yml` + `application-batch.yml` 로드. 내장 톰캣 OFF. |
| `BATCH_JOB_NAME=daily-schedule-sync` | `BatchDispatcher` 가 실행할 배치를 결정하는 유일한 분기 키. |

- `web-application-type: none` → 톰캣 비활성화, 포트 미사용
- `BatchDispatcher(ApplicationRunner)` 가 컨텍스트 기동 직후 배치를 실행하고 `System.exit()` 로 종료

### 3-3. 분기점 코드 스니핏

`BatchDispatcher` 가 환경변수 → 배치 선택 → 실행 → 종료까지의 **전체 분기 흐름**을 담당한다.
시작/종료 시 `batch_execution_logs` 테이블에 **각각 별도 행을 INSERT** 하여 실행 이력을 남기고,
실행 중에는 **3분 간격으로 RUNNING 하트비트**를 INSERT 하여 배치 생존 여부를 모니터링한다:

```kotlin
@Component
@Profile("batch")
class BatchDispatcher(
    private val jobs: Map<String, BatchJob>,
    private val context: ApplicationContext,
    private val executionLogRepository: BatchExecutionLogRepository,
) : ApplicationRunner {

    override fun run(args: ApplicationArguments) {
        // 1️⃣ 실행할 배치 결정 (환경변수 우선, 없으면 CLI 인자)
        val jobName = System.getenv("BATCH_JOB_NAME")
            ?: args.sourceArgs.firstOrNull()
            ?: throw IllegalArgumentException("...")

        // 2️⃣ 등록된 BatchJob 에서 조회
        val job = jobs[jobName] ?: throw IllegalArgumentException("...")

        // 3️⃣ 시작 이력 INSERT (STARTED 행)
        val executionId = UUID.randomUUID().toString()
        val startedAt = OffsetDateTime.now()
        executionLogRepository.save(BatchExecutionLog.started(executionId, jobName, startedAt))

        // 4️⃣ 하트비트 시작 (3분마다 RUNNING 행 INSERT)
        val heartbeat = startHeartbeat(executionId, jobName, startedAt)

        // 5️⃣ 실행 → 하트비트 종료 → 종료 이력 INSERT (SUCCESS / FAILURE 행)
        try {
            job.execute()
            heartbeat.shutdown()
            executionLogRepository.save(BatchExecutionLog.success(executionId, jobName, startedAt))
            System.exit(SpringApplication.exit(context, { 0 }))
        } catch (e: Exception) {
            heartbeat.shutdown()
            executionLogRepository.save(BatchExecutionLog.failure(executionId, jobName, startedAt, e))
            System.exit(SpringApplication.exit(context, { 1 }))
        }
    }
}
```

웹 서버 모드에서는 `@Profile("batch")` 에 의해 이 클래스가 **빈으로 등록조차 되지 않으므로**,
`ApplicationRunner` 가 실행되지 않고 톰캣이 정상 기동된다.

### 3-4. application-batch.yml

```yaml
spring:
  main:
    web-application-type: none      # 내장 톰캣 비활성화
    banner-mode: log
```

배치 전용으로 추가되는 설정은 이게 전부다. DB·시크릿 등은 `dev`/`prod` 프로파일에서 가져온다.

### 3-5. 패키지 레이어

```
src/main/kotlin/com/place/
├── app/                              # 서비스 레이어 (웹·배치 공용)
│   └── v1/
│       ├── DailyScheduleService.kt   #   인터페이스
│       └── impl/
│           └── DailyScheduleServiceImpl.kt
├── batch/                            # 🆕 배치 전용 (모두 @Profile("batch"))
│   ├── BatchJob.kt                   #   배치 인터페이스
│   ├── BatchDispatcher.kt            #   ApplicationRunner (진입점)
│   ├── BatchExecutionLog.kt          #   실행 이력 엔티티 (이벤트 로그)
│   ├── BatchExecutionLogRepository.kt
│   └── jobs/
│       └── DailyScheduleSyncJob.kt   #   첫 번째 배치
└── infra/
    └── schedule/
        ├── SchedulingConfig.kt       # 🆕 @Profile("!batch") + @EnableScheduling
        └── DailyScheduleSyncScheduler.kt  # @Profile("!batch")
```

`batch/` 패키지 아래의 모든 클래스는 `@Profile("batch")` 를 달고 있어서,
웹 서버 모드에서는 **빈으로 등록조차 되지 않는다.** 반대도 마찬가지.

---

## 4. 구현 상세

### 4-1. `BatchJob` 인터페이스

```kotlin
interface BatchJob {
    fun execute()
}
```

### 4-2. `BatchDispatcher` (배치 진입점)

```kotlin
@Component
@Profile("batch")
class BatchDispatcher(
    private val jobs: Map<String, BatchJob>,
    private val context: ApplicationContext,
    private val executionLogRepository: BatchExecutionLogRepository,
) : ApplicationRunner {

    override fun run(args: ApplicationArguments) {
        val jobName = System.getenv("BATCH_JOB_NAME")
            ?: args.sourceArgs.firstOrNull()
            ?: throw IllegalArgumentException(
                "실행할 배치명을 지정하세요. (BATCH_JOB_NAME 환경변수 또는 첫 번째 인자)\n등록된 배치: ${jobs.keys}"
            )

        val job = jobs[jobName]
            ?: throw IllegalArgumentException("알 수 없는 배치: '$jobName'. 등록된 배치: ${jobs.keys}")

        val executionId = UUID.randomUUID().toString()
        val startedAt = OffsetDateTime.now()

        // ── 시작 이력 INSERT ──
        executionLogRepository.save(BatchExecutionLog.started(executionId, jobName, startedAt))
        logger.info("[BATCH] ── $jobName 시작 (executionId=$executionId) ──")

        // ── 하트비트 시작 (3분마다 RUNNING 행 INSERT) ──
        val heartbeat = startHeartbeat(executionId, jobName, startedAt)

        try {
            job.execute()
            heartbeat.shutdown()
            // ── 성공 이력 INSERT ──
            executionLogRepository.save(BatchExecutionLog.success(executionId, jobName, startedAt))
            logger.info("[BATCH] ── $jobName 완료 (executionId=$executionId) ──")
            val exitCode = SpringApplication.exit(context, { 0 })
            System.exit(exitCode)
        } catch (e: Exception) {
            heartbeat.shutdown()
            // ── 실패 이력 INSERT ──
            executionLogRepository.save(BatchExecutionLog.failure(executionId, jobName, startedAt, e))
            logger.error("[BATCH] ── $jobName 실패 (executionId=$executionId) ──", e)
            val exitCode = SpringApplication.exit(context, { 1 })
            System.exit(exitCode)
        }
    }
}
```

**포인트:**
- `ApplicationRunner` 를 사용한다 (`CommandLineRunner` 가 아님 — 부록 A 참고).
- `SpringApplication.exit()` 으로 컨텍스트를 정리한 뒤 `System.exit()` 로 프로세스를 명시적으로 종료한다.
- 성공 = exit 0, 실패 = exit 1. K8s 가 exit code 를 보고 재시도 여부를 판단한다.
- **배치 실행 이력**은 시작/종료 시 각각 별도 행을 INSERT 한다. UPDATE 없이 INSERT-only 이므로 트랜잭션이 짧고, 여러 배치가 동시에 돌아도 안전하다.
- **하트비트**: 실행 중 3분 간격으로 `RUNNING` 행을 INSERT. 배치가 중간에 죽으면 마지막 하트비트의 `recorded_at` 으로 사망 시점을 추정할 수 있다.

### 4-2-1. `BatchExecutionLog` (실행 이력 엔티티)

하나의 배치 실행에 대해 **2개 이상의 행**이 기록된다:

| 시점 | status | batchStartedAt | batchFinishedAt | errorMessage |
|------|--------|----------------|-----------------|---------------|
| 배치 시작 | `STARTED` | 시작 시각 | null | null |
| 실행 중 (3분 간격) | `RUNNING` | 시작 시각 | null | null |
| 배치 종료 (성공) | `SUCCESS` | 시작 시각 | 종료 시각 | null |
| 배치 종료 (실패) | `FAILURE` | 시작 시각 | 종료 시각 | 예외 메시지 (최대 1000자) |

같은 `executionId` (UUID) 로 시작/종료 행을 JOIN 하면 소요 시간 등을 조회할 수 있다.
`RUNNING` 하트비트 행은 3분 간격으로 INSERT 되며, 배치가 중간에 죽으면 마지막 하트비트의
`recorded_at` 으로 사망 시점을 추정할 수 있다.
`recordedAt` 은 행이 INSERT 된 시각이며 변경 불가(updatable = false).

```sql
-- 최근 배치 실행 현황 조회
SELECT s.execution_id,
       s.job_name,
       s.batch_started_at,
       f.batch_finished_at,
       f.status,
       f.error_message
  FROM batch_execution_logs s
  LEFT JOIN batch_execution_logs f
    ON s.execution_id = f.execution_id AND f.status IN ('SUCCESS', 'FAILURE')
 WHERE s.status = 'STARTED'
 ORDER BY s.batch_started_at DESC;
```

```sql
-- 중간에 죽은 배치 탐지 (마지막 하트비트가 10분 이상 전 + 종료 로그 없음)
SELECT s.execution_id, s.job_name, s.batch_started_at,
       MAX(r.recorded_at) AS last_heartbeat
  FROM batch_execution_logs s
  LEFT JOIN batch_execution_logs f
    ON s.execution_id = f.execution_id AND f.status IN ('SUCCESS', 'FAILURE')
  LEFT JOIN batch_execution_logs r
    ON s.execution_id = r.execution_id AND r.status = 'RUNNING'
 WHERE s.status = 'STARTED'
   AND f.id IS NULL
   AND (r.recorded_at IS NULL OR r.recorded_at < now() - INTERVAL '10 minutes')
 GROUP BY s.execution_id, s.job_name, s.batch_started_at;
```

### 4-3. 배치 작업 추가 방법

```kotlin
@Component("my-new-batch")   // ← 이 이름이 BATCH_JOB_NAME 값
@Profile("batch")
class MyNewBatchJob(
    private val someService: SomeService,
) : BatchJob {
    override fun execute() {
        someService.doSomething()
    }
}
```

CronJob yaml 하나 추가:

```yaml
env:
  - name: BATCH_JOB_NAME
    value: "my-new-batch"
```

**배치 추가 = Kotlin 파일 1개 + CronJob yaml 1개.** 그 외에 건드릴 것이 없다.

---

## 5. dev / prod 배치 환경 분리

### 프로파일 조합

| 환경 | 웹 서버 | 배치 |
|------|--------|------|
| 로컬 개발 | `local` | IDE 에서 직접 실행 |
| 개발 서버 | `dev` | `dev,batch` |
| 운영 서버 | `prod` | `prod,batch` |

`SPRING_PROFILES_ACTIVE=prod,batch` 로 설정하면:
1. `application.yml` (공통) 로드
2. `application-prod.yml` (운영 DB, 시크릿 등) 로드
3. `application-batch.yml` (웹 서버 off) 로드

### 환경변수 관리 — 폭발하지 않는 이유

```yaml
# prod-batch-cronjob.yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    value: "prod,batch"
  - name: BATCH_JOB_NAME
    value: "daily-schedule-sync"
envFrom:
  - secretRef:
      name: place-back-prod-secrets   # 웹 서버 Deployment 와 동일한 Secret
```

**Secret/ConfigMap 을 웹 서버와 공유**하면 배치 전용으로 관리할 환경변수는
`BATCH_JOB_NAME` 하나뿐이다. 이게 "같은 이미지" 전략의 가장 큰 장점이다.

---

## 6. K8s CronJob 매니페스트

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-schedule-sync
  namespace: place
  labels:
    app: place-back
    component: batch
spec:
  # ── 스케줄 ──
  schedule: "0 0 * * *"              # 매일 자정
  timeZone: "Asia/Seoul"             # K8s 1.27+

  # ── 동시성 제어 ──
  concurrencyPolicy: Forbid          # 이전 Job 이 안 끝났으면 이번 실행 스킵
  startingDeadlineSeconds: 300       # 5분 안에 시작 못하면 이번 회차 포기

  # ── 히스토리 ──
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5

  jobTemplate:
    spec:
      backoffLimit: 2                # 실패 시 최대 2회 재시도
      activeDeadlineSeconds: 600     # 전체 Job 타임아웃 10분
      ttlSecondsAfterFinished: 86400 # 완료 후 24시간 뒤 Pod 자동 정리

      template:
        metadata:
          labels:
            app: place-back
            component: batch
        spec:
          restartPolicy: Never

          containers:
            - name: batch
              image: your-registry/place-back:latest
              env:
                - name: SPRING_PROFILES_ACTIVE
                  value: "prod,batch"
                - name: BATCH_JOB_NAME
                  value: "daily-schedule-sync"
              envFrom:
                - secretRef:
                    name: place-back-secrets
              resources:
                requests:
                  memory: "512Mi"
                  cpu: "250m"
                limits:
                  memory: "1Gi"
                  cpu: "500m"
```

### CronJob 주요 설정 해설

| 설정 | 역할 | 권장값 |
|------|------|--------|
| `concurrencyPolicy: Forbid` | 이전 배치가 아직 돌고 있으면 새 배치 생성 안 함 | 데이터 정합성 보호 |
| `backoffLimit: 2` | 컨테이너가 exit 1 로 종료 시 최대 2회 재시도 | 일시적 네트워크 장애 대응 |
| `activeDeadlineSeconds: 600` | 10분 넘으면 강제 종료 | 무한 대기 방지 |
| `startingDeadlineSeconds: 300` | 스케줄 시간에서 5분 초과 지연 시 이번 회차 포기 | 클러스터 부하 시 밀림 방지 |
| `ttlSecondsAfterFinished` | 완료된 Pod 를 자동 정리 | 디스크/etcd 절약 |

### 수동 실행

```bash
# 특정 CronJob 을 지금 바로 실행
kubectl create job manual-sync --from=cronjob/daily-schedule-sync

# 로그 확인
kubectl logs job/manual-sync
```

---

### 실행시 분기처리 (How-To-Use)

#### 웹 서버 : Deployment.yml
- Deployment yaml의 `env` 섹션에 아래 입력

```yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    value: "prod"
envFrom:
  - secretRef:
      name: place-back-prod-secrets
```

- `SPRING_PROFILES_ACTIVE=prod` → 톰캣 뜨고, `@Scheduled` 스케줄러도 동작
- `BATCH_JOB_NAME` 같은 건 **안 줌** → `BatchDispatcher`가 `@Profile("batch")`라서 빈 등록 자체가 안 됨
- 이미지의 ENTRYPOINT(`exec java $JAVA_OPTS -jar ${app}.jar`)가 그냥 웹 서버로 기동


#### 배치 — CronJob.yaml

CronJob yaml의 `env` 섹션에 이렇게 줍니다:

```yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    value: "prod,batch"          # ← 여기서 batch 프로파일 추가
  - name: BATCH_JOB_NAME
    value: "daily-schedule-sync" # ← 여기서 실행할 배치 지정
envFrom:
  - secretRef:
      name: place-back-prod-secrets  # 웹이랑 동일한 Secret 공유
```

- `prod,batch` → `application-batch.yml`이 추가로 로드되면서 `web-application-type: none` (톰캣 OFF)
- `BATCH_JOB_NAME` → `BatchDispatcher`가 이 값을 읽어서 해당 배치만 실행하고 `System.exit()`로 종료
- CronJob 자체에 `schedule: "0 0 * * *"`, `concurrencyPolicy: Forbid`, `backoffLimit: 2` 같은 스케줄/재시도 정책이 걸려있음


#### 정리하면

| 구분 | K8s 리소스 | 환경변수 차이 | 결과 |
|------|-----------|-------------|------|
| 웹 서버 | `Deployment` | `SPRING_PROFILES_ACTIVE=prod` | 톰캣 기동, 상시 실행 |
| 배치 | `CronJob` | `SPRING_PROFILES_ACTIVE=prod,batch` + `BATCH_JOB_NAME=xxx` | 톰캣 없이 배치 실행 후 종료 |

**이미지, ENTRYPOINT, Secret/ConfigMap 전부 동일**하고, 차이점은 딱 두 가지뿐입니다:
1. K8s 리소스 종류가 `Deployment` vs `CronJob`
2. 환경변수에 `batch` 프로파일과 `BATCH_JOB_NAME` 추가 여부

그 외에 CronJob 매니페스트에만 있는 건 K8s 레벨의 스케줄링/재시도 설정(`schedule`, `concurrencyPolicy`, `backoffLimit`, `activeDeadlineSeconds` 등)이고, 이건 애플리케이션 코드와 무관하게 인프라에서 처리하는 부분


---

## 7.로컬에서 k8s CronJob 없이 batch 테스트 

- 로컬 개발에서도 k8s 올리고 복잡하게 설정하기 현실적으로 곤란하다. 아래 방법으로 쉽게 로컬 테스트 세팅이 가능하다

### IntelliJ에서 실행

**Run Configuration** 하나 만들면 됩니다:

1. 상단 메뉴 → **Run → Edit Configurations → Spring Boot**
2. 이렇게 설정:
    - **Main class**: `com.place.PlaceApplicationKt` (기존 웹 서버랑 동일)
    - **Active profiles**: `local,batch`
    - **Environment variables**: `BATCH_JOB_NAME=${BATCH_NAME}`

또는 Active profiles 칸 대신 Environment variables에 한번에 넣어도 됩니다:
```
SPRING_PROFILES_ACTIVE=local,batch;BATCH_JOB_NAME=${BATCH_NAME}
```

실행하면 톰캣 안 뜨고, 배치 돌고, 바로 프로세스 종료됩니다.

---

### 커맨드라인에서 실행 (Gradle)

```bash
./gradlew bootRun --args='--spring.profiles.active=local,batch' -Dspring-boot.run.jvmArgs='-DBATCH_JOB_NAME=daily-schedule-sync'
```

또는 환경변수로 주는 게 더 깔끔합니다:

```bash
SPRING_PROFILES_ACTIVE=local,batch BATCH_JOB_NAME=daily-schedule-sync ./gradlew bootRun
```

---

### 커맨드라인에서 실행 (JAR 직접)

빌드 후 JAR로 실행:

```bash
./gradlew bootJar

SPRING_PROFILES_ACTIVE=local,batch BATCH_JOB_NAME=daily-schedule-sync java -jar build/libs/place-back-*.jar
```

---

### 참고

- 프로파일은 `local,batch`입니다 (`prod,batch`가 아님). `local` 프로파일이 로컬 DB 설정을 가져오니까요.
- `BATCH_JOB_NAME` 값은 `@Component("daily-schedule-sync")`에 지정된 빈 이름과 일치해야 합니다.
- 배치가 끝나면 `System.exit()`로 프로세스가 종료되므로, IntelliJ 콘솔에서 "Process finished with exit code 0"이 뜨면 성공




---

## 8. 향후 확장 청사진

### Phase 1: 현재 (배치 1개)

```
place-back (단일 이미지)
├── 웹 서버 모드: Profile = prod
└── 배치 모드:   Profile = prod,batch
    └── BATCH_JOB_NAME=daily-schedule-sync
```

- CronJob 1개, `BatchJob` 구현체 1개
- 환경변수 추가 = `BATCH_JOB_NAME` 1개

### Phase 2: 배치 2~5개

```
place-back (단일 이미지, 동일)
└── 배치 모드
    ├── daily-schedule-sync   (CronJob A, 매일 00:00)
    ├── daily-attendance-sync (CronJob B, 매일 00:30)
    └── weekly-report         (CronJob C, 매주 월 09:00)
```

- 배치 추가 = `BatchJob` 구현체 1개 + CronJob yaml 1개
- 각 배치의 스케줄, 리소스, 재시도 정책을 **독립적으로** 설정 가능
- 이미지는 여전히 1개

### Phase 3: 대량 데이터 처리가 필요해질 때

아래 중 **2개 이상 해당**되면 Spring Batch 도입을 검토:

- [ ] 단일 배치가 수십만 건 이상의 데이터를 처리
- [ ] 실패 지점부터 재시작(checkpoint/restart) 이 반드시 필요
- [ ] Step 간 조건 분기(성공 시 A, 실패 시 B) 가 복잡
- [ ] 멀티 파티셔닝으로 병렬 처리가 필요
- [ ] 배치 실행 이력을 DB 에서 쿼리/감사해야 하는 컴플라이언스 요구

현재 `syncDaily()` 수준에서는 해당 사항 없음.

---

## 8. 방식별 장단점 비교

### 8-1. K8s CronJob vs Spring Batch

| 항목 | K8s CronJob + ApplicationRunner | Spring Batch |
|------|--------------------------------|--------------|
| **도입 비용** | 거의 없음 (기존 코드 활용) | starter 의존성 + 메타 테이블 5개 DDL |
| **인프라 복잡도** | CronJob yaml 1개 | 배치 메타 DB + 별도 설정 클래스 |
| **스케줄링** | K8s 가 담당 (cron 표현식) | 별도 트리거 필요 (Quartz 등) |
| **재시도** | `backoffLimit` 으로 K8s 가 처리 | Job/Step 레벨 retry 설정 |
| **실패 지점 재시작** | ❌ 처음부터 다시 실행 | ✅ 마지막 성공 청크부터 재시작 |
| **청크 단위 처리** | 직접 구현해야 함 | Reader→Processor→Writer 프레임워크 제공 |
| **병렬 파티셔닝** | 직접 구현 또는 Job 여러 개 | 내장 파티셔닝 지원 |
| **모니터링** | `kubectl get jobs` + 로그 | Spring Batch Admin / 메타 테이블 쿼리 |
| **학습 곡선** | 낮음 | 높음 (Job, Step, Chunk, Tasklet 개념) |
| **적합한 규모** | 배치 1~10개, 단순 로직 | 대량 데이터, 복잡한 흐름 제어 |

### 8-2. K8s CronJob (동일 이미지) vs Jenkins + 배치 전용 이미지

| 항목 | K8s CronJob (동일 이미지) | Jenkins + 별도 배치 이미지 |
|------|--------------------------|--------------------------|
| **이미지 관리** | 웹 서버와 **동일 이미지** 1개 | 웹용 / 배치용 이미지 **2개** 별도 빌드·배포 |
| **버전 동기화** | 항상 동일 버전 (같은 이미지 태그) | 웹/배치 이미지 버전 불일치 위험 |
| **빌드 파이프라인** | CI/CD 1개로 통합 | 웹 빌드 + 배치 빌드 **파이프라인 2개** 필요 |
| **인프라 의존성** | K8s 만 있으면 됨 | Jenkins 서버 별도 운영 필요 |
| **스케줄링 신뢰성** | K8s 컨트롤 플레인이 보장 | Jenkins 서버 장애 시 배치 미실행 |
| **리소스 효율** | 배치 실행 시에만 Pod 생성 → 종료 | Jenkins 에이전트 상시 대기 또는 동적 프로비저닝 |
| **환경변수 관리** | Secret/ConfigMap 웹과 공유 | Jenkins Credentials + 배치 전용 env 이중 관리 |
| **로그 확인** | `kubectl logs job/xxx` | Jenkins 콘솔 출력 (별도 시스템) |
| **실패 재시도** | `backoffLimit` 자동 재시도 | Jenkins retry 플러그인 또는 수동 |
| **확장성** | CronJob yaml 추가만으로 배치 추가 | Jenkinsfile + Dockerfile 추가 |

**결론:** 별도 이미지 방식은 "웹 코드 변경 → 배치 이미지도 다시 빌드해야 하나?" 같은
동기화 문제가 항상 따라다닌다. 동일 이미지 + Profile 분리가 훨씬 깔끔하다.

---

## 부록

### 부록 A. 과거 방식 — CommandLineRunner

과거에는 `CommandLineRunner` 를 사용하는 패턴도 흔했다:

```kotlin
@Component
@Profile("batch")
class DailyScheduleBatchRunner(
    private val dailyScheduleService: DailyScheduleService,
) : CommandLineRunner {
    override fun run(vararg args: String?) {
        dailyScheduleService.syncDaily()
    }
}
```

이 방식은 **단일 배치**에서는 간단하지만, 배치가 여러 개로 늘어날 때 문제가 생긴다:

- `CommandLineRunner` 가 여러 개 등록되면 **모두 실행된다** (원하는 것 하나만 돌릴 수 없음)
- 실행 순서 제어가 `@Order` 에 의존해 불명확
- `String` 타입의 raw args 를 직접 파싱해야 함

`ApplicationRunner` + `BatchDispatcher` 패턴으로 전환하면 `BATCH_JOB_NAME` 으로
원하는 배치만 골라서 실행할 수 있다. 그래서 처음부터 `ApplicationRunner` 를 사용했다.

### 부록 B. 멀티 모듈 분리 — 완벽하지만 비용이 있다

과거 프로젝트에서는 이런 식으로 모듈을 분리했다:

```
project-root/
├── module-domain/       # 순수 도메인 로직 (JPA 엔티티, 서비스)
├── module-api/          # 웹 서버 (컨트롤러, 필터, 인터셉터)
└── module-batch/        # 배치 전용 (Spring Batch Job, Step)
```

**장점:**
- 컴파일 타임에 의존 방향이 강제된다 (batch → domain ✅, batch → api ❌)
- 배치 이미지에 웹 관련 코드가 아예 포함되지 않음 (이미지 크기 최소화)
- 팀이 크면 모듈별로 담당자를 나눌 수 있음
- "완벽한 분리" 라는 심리적 안정감

**단점 (트레이드오프):**
- `build.gradle.kts` 가 3개 이상, 의존성 선언 중복
- 공통 코드 변경 시 여러 모듈 동시 수정 → 빌드/테스트 시간 증가
- 이미지가 2개 이상 → CI/CD 파이프라인 복잡도 증가
- 도메인 레이어를 "정말 순수하게" 유지하려면 끊임없는 리팩토링 필요
- 소규모 팀(1~3명)에서는 모듈 간 이동 오버헤드가 생산성을 깎음

**현재 프로젝트에 맞는 판단:**

이 프로젝트는 소규모 팀이 빠르게 개발하는 단계이므로,
**단일 모듈 + `@Profile` 분리**가 복잡도 대비 효과가 가장 좋다.
`batch/` 패키지의 모든 클래스에 `@Profile("batch")` 를 달아서
웹 모드에서는 빈으로 등록조차 안 되게 하면, 런타임 분리는 멀티 모듈과 동일하다.

나중에 팀이 커지고 배치가 10개 이상으로 늘어나면 그때 모듈 분리를 검토해도 늦지 않다.
Profile 기반 분리에서 모듈 분리로 전환하는 것은 **패키지를 모듈로 옮기는 것**이라
마이그레이션 비용이 크지 않다.
