# Spring Statemachine 톺아보기

- Spring Statemachine은 복잡한 도메인의 상태(State)와 상태 전이(State Transition) 흐름을 안전하고 명확하게 관리하도록 돕는 Spring 프로젝트입니다.
- 이번 글에서는 유한 상태 머신(Finite State Machine, FSM) 개념을 Spring 생태계에 녹여낸 모듈 `Spring Statemachine`에 대해서 톺아보고, 이벤트 기반의 상태 제어를 깔끔하게 구현할 수 있는 예시도 만들며 학습한 내용을 정리합니다.

---

## 1. 탄생 배경 및 필요성

하드웨어 연동이 필요한데, 서버랑 통신도 하는 웹 백엔드에서는, 비즈니스 로직이 복잡해질수록 상태 변경 조건이 늘어나고, 코드베이스는 수많은 `if-else`나 `switch-case` 조건문으로 뒤덮이게 되는데요

```kotlin
// ❌ 조건문 지옥 (Spaghetti Code)
if (order.status == OrderStatus.PAID) {
    if (event == Event.CANCEL && order.isRefundable()) {
        order.status = OrderStatus.REFUNDED
    } else if (/* ... */) {
        // ...
    }
}
// if-elif 로 모든 코드가 뒤덮이면 만든놈도 AI 도 도망가요...
```

### FSM 개념을 웹 백엔드에 녹여낼때 발생하는 이슈 해결
- FSM 개념을 웹 백엔드에서 녹여낼때 발생하는 이슈를 해결해주는  Spring Statemachine은 아래의 개념으로 풀어줘요

| 강점 | 내용 |
| --- | --- |
| 상태 전이의 명확한 선언 | 허용되는 상태 변경 경로를 한곳에서 선언적으로 정의 |
| 잘못된 상태 변경 방지 | 정의되지 않은 이벤트가 들어오면 무시하거나 에러를 발생시켜 비즈니스 일관성을 프레임워크 수준에서 보장 |
| 복잡도 분리 | 부수 효과(Action), 전이 조건(Guard), 이벤트 수신 처리(Listener)를 개별 컴포넌트로 격리 |
| Spring 생태계 통합 | Spring Security(권한 검증), Spring Data JPA/Redis(상태 영속화), Spring Event와 매끄럽게 연동 |

- 결론적으로 모든 소스코드를 IF-ELIF 로 떡칠하지 않아도 상태와 상태 기반의 비즈니스 로직을 작성할 수 있도록 지원해주는 모듈입니다.
- 모듈이라고 표현했는데 제 생각에는 어떤 기능을 추가하는 `모듈` 이라는 키워드 보다는 `서브패러다임 아키텍쳐` 추가.. 라고 하고싶은데요 너무 복잡하고 쓸데없이 용어를 만들 필요는 없으니 패스

---

## 2. 주요 모듈

필요에 맞춰 골라 쓸 수 있도록 모듈화되어 있어요

| 모듈명 | 역할 및 특징 |
| --- | --- |
| `spring-statemachine-core` | FSM의 핵심 엔진. DSL 설정, 상태 및 전이 인터페이스 제공 |
| `spring-statemachine-starter` | Spring Boot 환경에서 자동 구성(Auto-configuration)을 지원하는 스타터 |
| `spring-statemachine-data-jpa` | JPA를 통해 머신의 상태·컨텍스트·히스토리를 RDB에 저장/복원 |
| `spring-statemachine-data-redis` | Redis를 활용한 분산 환경에서의 상태 영속화 |
| `spring-statemachine-test` | 상태 변화, 이벤트 처리 과정을 검증하기 위한 테스트 유틸리티 |
| `spring-statemachine-zookeeper` | ZooKeeper로 여러 분산 노드 간 상태 머신 동기화 제공 |

---

## 3. 주요 활용처

| 도메인 | 상태 흐름 예시 |
| --- | --- |
| 커머스 / 결제 | `CREATED → PAID → DELIVERING → DELIVERED / CANCELLED` |
| 승인 / 워크플로우 | `PENDING → UNDER_REVIEW → APPROVED / REJECTED` |
| IoT 기기 제어 | `OFFLINE → CONNECTING → ONLINE → ERROR` |
| 게임 / 로비 매칭 | `WAITING → MATCHING → IN_GAME → FINISHED` |

---

## 4. 환경 설정 (Spring Boot 4.x, JDK 25, Kotlin)

`build.gradle.kts` 설정 예시

```kotlin
plugins {
    id("org.springframework.boot") version "4.0.0"
    id("io.spring.dependency-management") version "1.1.7"
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.spring") version "2.1.0"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

repositories {
    mavenCentral()
}

extra["springStatemachineVersion"] = "4.0.2"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter")
    implementation("org.jetbrains.kotlin:kotlin-reflect")

    // Spring Statemachine Starter
    implementation("org.springframework.statemachine:spring-statemachine-starter")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.statemachine:spring-statemachine-test")
}

dependencyManagement {
    imports {
        mavenBom("org.springframework.statemachine:spring-statemachine-bom:${property("springStatemachineVersion")}")
    }
}
```

---

## 5. 기초 사용법 (Single Instance)

단일 상태 머신을 구성하는 기초 예제예요.

### ① State 및 Event 정의

```kotlin
enum class OrderState { CREATED, PAID, DELIVERED }
enum class OrderEvent { PAY, DELIVER }
```

### ② State Machine Config 작성

```kotlin
import org.springframework.context.annotation.Configuration
import org.springframework.statemachine.config.EnableStateMachine
import org.springframework.statemachine.config.EnumStateMachineConfigurerAdapter
import org.springframework.statemachine.config.builders.StateMachineStateConfigurer
import org.springframework.statemachine.config.builders.StateMachineTransitionConfigurer
import java.util.EnumSet

@Configuration
@EnableStateMachine
class OrderStateMachineConfig : EnumStateMachineConfigurerAdapter<OrderState, OrderEvent>() {

    override fun configure(states: StateMachineStateConfigurer<OrderState, OrderEvent>) {
        states
            .withStates()
            .initial(OrderState.CREATED)
            .states(EnumSet.allOf(OrderState::class.java))
    }

    override fun configure(transitions: StateMachineTransitionConfigurer<OrderState, OrderEvent>) {
        transitions
            .withExternal()
                .source(OrderState.CREATED).target(OrderState.PAID)
                .event(OrderEvent.PAY)
                .action { println("💳 결제 처리 완료") }
            .and()
            .withExternal()
                .source(OrderState.PAID).target(OrderState.DELIVERED)
                .event(OrderEvent.DELIVER)
                .action { println("🚚 배송 시작") }
    }
}
```

---

## 6. IoT 기기 제어 실무 아키텍처 (StateMachineFactory 기반)

실제 운영 환경에서는 기기마다 고유한 `deviceId`로 독립된 상태를 유지해요. 싱글톤 StateMachine 하나를 공유하면 동시성 문제와 상태 꼬임이 생기니까, `StateMachineFactory`로 요청 시점마다 특정 `deviceId`의 상태 머신 인스턴스를 생성·복원하고, 처리 후 영속화하는 패턴을 써요.

### 전체 아키텍처 흐름

```text
[IoT Device / Client]
         │ (1) Event (e.g. CONNECT) + deviceId
         ▼
[DeviceStateMachineService]
         │ (2) DB/Redis에서 deviceId의 현재 상태 조회 (e.g. OFFLINE)
         │ (3) StateMachineFactory.getStateMachine(deviceId) 호출
         │ (4) resetStateMachine()으로 머신 상태를 OFFLINE으로 복원
         │ (5) stateMachine.sendEvent(CONNECT) 전송
         │ (6) StateMachineInterceptor에서 상태 변경 감지 → DB/Redis 자동 저장
         ▼
[DB / Redis Persistence]
```

### ① State & Event 정의

```kotlin
package com.example.iot.statemachine

enum class DeviceState {
    OFFLINE,    // 오프라인
    CONNECTING, // 연결 진행 중
    ONLINE,     // 온라인 (정상 작동)
    ERROR       // 에러 상태
}

enum class DeviceEvent {
    CONNECT,          // 연결 시도
    CONNECT_SUCCESS,  // 연결 성공
    CONNECT_FAIL,     // 연결 실패
    DISCONNECT,       // 연결 해제
    OCCUR_ERROR,      // 장애 발생
    RESET             // 복구/리셋
}
```

### ② StateMachineFactory 설정 — `DeviceStateMachineConfig.kt`

```kotlin
package com.example.iot.statemachine

import org.springframework.context.annotation.Configuration
import org.springframework.statemachine.config.EnableStateMachineFactory
import org.springframework.statemachine.config.EnumStateMachineConfigurerAdapter
import org.springframework.statemachine.config.builders.StateMachineStateConfigurer
import org.springframework.statemachine.config.builders.StateMachineTransitionConfigurer
import java.util.EnumSet

@Configuration
@EnableStateMachineFactory // 💡 싱글톤이 아닌 팩토리로 등록
class DeviceStateMachineConfig : EnumStateMachineConfigurerAdapter<DeviceState, DeviceEvent>() {

    override fun configure(states: StateMachineStateConfigurer<DeviceState, DeviceEvent>) {
        states
            .withStates()
            .initial(DeviceState.OFFLINE)
            .states(EnumSet.allOf(DeviceState::class.java))
    }

    override fun configure(transitions: StateMachineTransitionConfigurer<DeviceState, DeviceEvent>) {
        transitions
            // OFFLINE -> CONNECTING
            .withExternal()
                .source(DeviceState.OFFLINE).target(DeviceState.CONNECTING)
                .event(DeviceEvent.CONNECT)
                .action { ctx -> println("[${ctx.stateMachine.id}] 🔌 연결 시도 중...") }
            .and()

            // CONNECTING -> ONLINE
            .withExternal()
                .source(DeviceState.CONNECTING).target(DeviceState.ONLINE)
                .event(DeviceEvent.CONNECT_SUCCESS)
                .action { ctx -> println("[${ctx.stateMachine.id}] ✅ 연결 성공! ONLINE 전환") }
            .and()

            // CONNECTING -> OFFLINE (연결 실패 시)
            .withExternal()
                .source(DeviceState.CONNECTING).target(DeviceState.OFFLINE)
                .event(DeviceEvent.CONNECT_FAIL)
                .action { ctx -> println("[${ctx.stateMachine.id}] ❌ 연결 실패. OFFLINE 복귀") }
            .and()

            // ONLINE -> OFFLINE (연결 해제)
            .withExternal()
                .source(DeviceState.ONLINE).target(DeviceState.OFFLINE)
                .event(DeviceEvent.DISCONNECT)
                .action { ctx -> println("[${ctx.stateMachine.id}] 🛑 연결 종료") }
            .and()

            // 모든 상태 -> ERROR (장애 발생 시)
            .withExternal()
                .source(DeviceState.OFFLINE).target(DeviceState.ERROR).event(DeviceEvent.OCCUR_ERROR)
            .and()
            .withExternal()
                .source(DeviceState.CONNECTING).target(DeviceState.ERROR).event(DeviceEvent.OCCUR_ERROR)
            .and()
            .withExternal()
                .source(DeviceState.ONLINE).target(DeviceState.ERROR).event(DeviceEvent.OCCUR_ERROR)
            .and()

            // ERROR -> OFFLINE (리셋)
            .withExternal()
                .source(DeviceState.ERROR).target(DeviceState.OFFLINE)
                .event(DeviceEvent.RESET)
                .action { ctx -> println("[${ctx.stateMachine.id}] 🔄 장비 리셋 실행") }
    }
}
```

### ③ 상태 저장소 레포지토리 — `DeviceStateRepository.kt`

```kotlin
package com.example.iot.repository

import com.example.iot.statemachine.DeviceState
import org.springframework.stereotype.Repository
import java.util.concurrent.ConcurrentHashMap

@Repository
class DeviceStateRepository {
    // 실무에서는 JPA Repository 또는 Redis Template을 사용
    private val stateStore = ConcurrentHashMap<String, DeviceState>()

    fun findStateByDeviceId(deviceId: String): DeviceState {
        return stateStore[deviceId] ?: DeviceState.OFFLINE
    }

    fun saveState(deviceId: String, state: DeviceState) {
        stateStore[deviceId] = state
        println("💾 [DB/Redis 저장] deviceId: $deviceId -> 상태: $state")
    }
}
```

### ④ StateMachine 인터셉터 (자동 영속화 Hook) — `DeviceStateMachineInterceptor.kt`

```kotlin
package com.example.iot.statemachine

import com.example.iot.repository.DeviceStateRepository
import org.springframework.messaging.Message
import org.springframework.statemachine.StateMachine
import org.springframework.statemachine.state.State
import org.springframework.statemachine.support.StateMachineInterceptorAdapter
import org.springframework.statemachine.transition.Transition
import org.springframework.stereotype.Component

@Component
class DeviceStateMachineInterceptor(
    private val deviceStateRepository: DeviceStateRepository
) : StateMachineInterceptorAdapter<DeviceState, DeviceEvent>() {

    // 상태 전이가 발생할 때마다 변경된 상태를 DB/Redis에 자동 반영
    override fun preStateChange(
        state: State<DeviceState, DeviceEvent>?,
        message: Message<DeviceEvent>?,
        transition: Transition<DeviceState, DeviceEvent>?,
        stateMachine: StateMachine<DeviceState, DeviceEvent>?,
        rootStateMachine: StateMachine<DeviceState, DeviceEvent>?
    ) {
        val deviceId = stateMachine?.id ?: return
        val newState = state?.id ?: return
        deviceStateRepository.saveState(deviceId, newState)
    }
}
```

### ⑤ 인스턴스 생성/복원/이벤트 처리 서비스 — `DeviceStateMachineService.kt`

```kotlin
package com.example.iot.service

import com.example.iot.repository.DeviceStateRepository
import com.example.iot.statemachine.DeviceEvent
import com.example.iot.statemachine.DeviceState
import com.example.iot.statemachine.DeviceStateMachineInterceptor
import org.springframework.messaging.support.MessageBuilder
import org.springframework.statemachine.StateMachine
import org.springframework.statemachine.config.StateMachineFactory
import org.springframework.statemachine.support.DefaultStateMachineContext
import org.springframework.stereotype.Service
import reactor.core.publisher.Mono

@Service
class DeviceStateMachineService(
    private val stateMachineFactory: StateMachineFactory<DeviceState, DeviceEvent>,
    private val deviceStateRepository: DeviceStateRepository,
    private val interceptor: DeviceStateMachineInterceptor
) {

    /**
     * 특정 deviceId에 이벤트를 보내고 상태를 변경한다.
     */
    fun sendEvent(deviceId: String, event: DeviceEvent): Boolean {
        // 1. deviceId 기반으로 새 머신 인스턴스 생성
        val stateMachine = stateMachineFactory.getStateMachine(deviceId)

        try {
            // 2. DB/Redis에 저장돼 있던 최근 상태 복원
            val currentState = deviceStateRepository.findStateByDeviceId(deviceId)
            restoreStateMachine(stateMachine, currentState)

            // 3. 상태 변경 시 자동 영속화를 위해 인터셉터 등록
            stateMachine.stateMachineAccessor.doWithAllRegions { accessor ->
                accessor.addStateMachineInterceptor(interceptor)
            }

            // 4. 머신 시작
            stateMachine.startReactively().block()

            // 5. 이벤트 전송
            val message = MessageBuilder.withPayload(event)
                .setHeader("deviceId", deviceId)
                .build()

            val result = stateMachine.sendEvent(Mono.just(message)).blockLast()
            val isAccepted =
                result?.resultType == org.springframework.statemachine.StateMachineEventResult.ResultType.ACCEPTED

            return isAccepted
        } finally {
            // 6. 처리가 끝나면 리소스 해제 (메모리 누수 방지)
            stateMachine.stopReactively().block()
        }
    }

    /**
     * 머신의 현재 상태를 DB/Redis에 기록된 상태로 강제 맞춤 (State Restore)
     */
    private fun restoreStateMachine(
        stateMachine: StateMachine<DeviceState, DeviceEvent>,
        state: DeviceState
    ) {
        stateMachine.stateMachineAccessor.doWithAllRegions { accessor ->
            accessor.resetStateMachine(
                DefaultStateMachineContext(state, null, null, null)
            )
        }
    }

    /**
     * 특정 기기의 현재 상태 조회
     */
    fun getCurrentState(deviceId: String): DeviceState {
        return deviceStateRepository.findStateByDeviceId(deviceId)
    }
}
```

### ⑥ 실행 시뮬레이터 Runner — `IotDeviceRunner.kt`

```kotlin
package com.example.iot

import com.example.iot.service.DeviceStateMachineService
import com.example.iot.statemachine.DeviceEvent
import org.springframework.boot.CommandLineRunner
import org.springframework.stereotype.Component

@Component
class IotDeviceRunner(
    private val deviceService: DeviceStateMachineService
) : CommandLineRunner {

    override fun run(vararg args: String?) {
        val deviceId = "DEVICE-9901"

        println("\n=== 🤖 IoT Device State Machine 시뮬레이션 시작 ===")
        println("초기 상태: ${deviceService.getCurrentState(deviceId)}") // OFFLINE

        // 1. 연결 시도 (OFFLINE -> CONNECTING)
        deviceService.sendEvent(deviceId, DeviceEvent.CONNECT)
        println("현재 상태: ${deviceService.getCurrentState(deviceId)}") // CONNECTING

        // 2. 연결 완료 (CONNECTING -> ONLINE)
        deviceService.sendEvent(deviceId, DeviceEvent.CONNECT_SUCCESS)
        println("현재 상태: ${deviceService.getCurrentState(deviceId)}") // ONLINE

        // 3. 장애 발생 (ONLINE -> ERROR)
        deviceService.sendEvent(deviceId, DeviceEvent.OCCUR_ERROR)
        println("현재 상태: ${deviceService.getCurrentState(deviceId)}") // ERROR

        // 4. 리셋 (ERROR -> OFFLINE)
        deviceService.sendEvent(deviceId, DeviceEvent.RESET)
        println("최종 상태: ${deviceService.getCurrentState(deviceId)}") // OFFLINE
        println("===================================================\n")
    }
}
```

### 핵심 포인트 요약

| 포인트 | 내용 |
| --- | --- |
| `StateMachineFactory` 사용 | 동시다발적인 여러 기기/유저 상태를 처리하려면 싱글톤 `@EnableStateMachine` 대신 `@EnableStateMachineFactory`를 쓴다 |
| `resetStateMachine`으로 복원 | 매번 DB/Redis에서 저장된 `DeviceState`를 조회해 인스턴스 스냅샷을 최신화한다 |
| `StateMachineInterceptor` 활용 | 전이 성공 시 이벤트를 감지해 자동으로 DB/Redis에 동기화하므로, 비즈니스 로직과 저장 로직이 분리된다 |
| Lifecycle 관리 | 이벤트 한 번 처리가 끝나면 반드시 머신을 `stopReactively()`로 정지시켜 메모리 누수와 스레드 낭비를 막는다 |

---

## 7. 잠깐 — 이건 IoT '서버'용 모듈이지, 기기 본체용이 아니에요

앞의 코드는 100% IoT 관리 서버(백엔드/클라우드 서버)를 위한 모듈이에요. IoT 기기 본체에서 도는 게 아니에요.

### 왜 기기가 아니라 '서버'에서 돌릴까?

**① IoT 기기(Embedded Device)의 자원 한계**

- 스펙 부족 — 아두이노, ESP32, STM32 같은 소형 IoT 기기(마이크로컨트롤러)는 메모리가 몇 KB~몇 MB 수준밖에 안 돼요.
- JDK/Spring 구동 불가 — Spring Boot, JDK 25, JVM 같은 거대한 자바 실행 환경은 기기 메모리에 아예 올라가질 않아요.
- 기기 자체 언어 — 기기 내부 프로그램은 주로 C, C++, Rust, MicroPython 등으로 작성돼요.

**② 서버와 기기의 역할 분담**

| 구분 | IoT 기기 (Edge / Device) | IoT 관리 서버 (Spring Statemachine) |
| --- | --- | --- |
| 위치 | 스마트 가전·센서·공장 장비 본체 | AWS, Naver Cloud, 자체 서버 등 백엔드 |
| 언어 / 환경 | C / C++ / Rust | Java / Kotlin + Spring Boot |
| 역할 | 센서 데이터 수집, 모터·LED 제어, 서버로 MQTT/HTTP 메시지 전송 | 수천~수십만 대 기기의 전체 상태 중앙 관제, 비즈니스 규칙 검증, DB 기록 |
| 상태 관리 방식 | 가벼운 `switch-case`나 얇은 C 언어 FSM 라이브러리 | Spring Statemachine으로 분산·영속 상태 관리 |

### 실제 현장에서 함께 움직이는 흐름

1. **기기(Device)** — 전원이 켜지고 Wi-Fi 접속에 성공하면 서버로 MQTT 메시지를 쏜다.
   ```json
   { "deviceId": "SENSOR-01", "event": "CONNECT_SUCCESS" }
   ```
2. **관리 서버(Spring Statemachine)** — 메시지를 받으면 `deviceId`로 상태 머신 인스턴스를 하나 복원해 이벤트를 주입한다.
   - "현재 상태가 `CONNECTING`이었네? `CONNECT_SUCCESS`가 들어왔으니 `ONLINE`으로 바꾸고 DB/Redis에 저장하자."
   - 이상한 이벤트가 들어오면 서버 차원에서 무시하거나 오류 로그를 남긴다.
3. **관제 시스템(Web Dashboard)** — 관리자는 웹 화면에서 "SENSOR-01 정상 온라인"이라는 초록 불빛을 보게 된다.

정리하면, 기기는 그저 자기 일을 하고 메시지만 날릴 뿐이에요. 수많은 기기의 복잡한 상태와 전이 규칙을 중앙에서 제어하고 기록하는 '뇌' 역할을 Spring Statemachine이 서버에서 맡는 거죠.

---

## 8. HTTP 기반 양방향 통신 (서버 ↔ 기기)

MQTT 같은 프로토콜로 기기 메시지를 스프링 서버로 수신하는 구조가 일반적이지만, 여기서는 요청대로 HTTP 기반으로 양방향 연결의 기틀을 잡아볼게요. 서버와 기기 어느 쪽에서든 연결을 시작할 수 있는 구조예요.

### 시스템 구조 (1:N)

서버는 한 대지만 수많은 기기(Node)가 붙고, HTTP를 통해 서로가 서로에게 요청을 보낼 수 있어요. 서버 내부에서는 각 기기의 상태를 StateMachine으로 관리해요.

```text
==========================================================================
|                                                                        |
|   [ IoT 관리 서버 (중앙 관제) ]                                          |
|   (Spring Boot + Spring Statemachine)                                  |
|                                                                        |
|   +---------------------------------------+                            |
|   | 뇌 (The Brain)                        |                            |
|   |  - StateMachineFactory                |                            |
|   |  - DeviceStateMachineService          |                            |
|   |    (ID별 상태 인스턴스 복원/영속화)     |                            |
|   +---------------------------------------+                            |
|          ^                       |                                     |
|          | (1) HTTP Req (Event)  | (2) HTTP Req (Command)              |
|          |     Device -> Server  |     Server -> Device                |
|          |                       v                                     |
==========================================================================
           |                       |
           | HTTP 프로토콜          | (기기별 고유 IP/Port)
           v                       v
  +------------------+   +------------------+        +------------------+
  |  [ IoT 기기 1 ]  |   |  [ IoT 기기 2 ]  |        |  [ IoT 기기 N ]  |
  | (Embedded Srv)   |   | (Embedded Srv)   |  ...   | (Embedded Srv)   |
  |                  |   |                  |        |                  |
  | - HTTP Client    |   | - HTTP Client    |        | - HTTP Client    |
  | - 명령 수신 Srv  |   | - 명령 수신 Srv  |        | - 명령 수신 Srv  |
  +------------------+   +------------------+        +------------------+
     (가전, 센서)           (공장 장비)                   (CCTV 등)
```

### 전제 조건

- 서버와 기기는 서로의 IP 주소와 포트를 알고 있어야 해요.
- 실제 IoT 기기는 전력·네트워크 문제로 HTTP 서버를 직접 띄우기보다 MQTT를 선호하지만, 여기서는 요청대로 HTTP로 작성해요. 기기 쪽에도 아주 가벼운 HTTP 서버(내장 웹서버)가 돌고 있다고 가정할게요.

### A. 공통 모델 (Shared Models)

통신에 쓸 데이터 구조예요.

```kotlin
package com.example.iot.common

// 기기 -> 서버: 상태 변경 이벤트 보고용
data class DeviceEventRequest(
    val deviceId: String,
    val eventType: String,          // 예: "CONNECT", "TEMP_REPORT"
    val data: Map<String, Any>? = null
)

// 서버 -> 기기: 명령 하달용
data class ServerCommandRequest(
    val command: String,            // 예: "TURN_ON", "UPGRADE_FIRMWARE"
    val params: Map<String, Any>? = null
)

// 공통 응답 구조
data class ApiResponse(
    val status: String,             // "SUCCESS", "FAIL"
    val message: String? = null
)
```

### B. 기기 측 코드 (Device Side Simulation)

기기는 서버로 이벤트를 보내는 클라이언트 역할과, 서버의 명령을 받는 서버 역할을 동시에 해요.

```kotlin
package com.example.iot.device

import com.example.iot.common.ApiResponse
import com.example.iot.common.DeviceEventRequest
import com.example.iot.common.ServerCommandRequest
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.web.bind.annotation.*
import org.springframework.web.client.RestTemplate

@SpringBootApplication
class IotDeviceApplication

fun main(args: Array<String>) {
    // 기기 1 시뮬레이션 (8081 포트)
    System.setProperty("server.port", "8081")
    runApplication<IotDeviceApplication>(*args)
}

@RestController
@RequestMapping("/api/device")
class DeviceController {

    // 실무에서는 가벼운 HTTP Client 사용 (예: OkHttp, C 언어라면 libcurl)
    private val restTemplate = RestTemplate()
    private val serverUrl = "http://localhost:8080/api/server/event"
    private val myDeviceId = "DEVICE-9901"

    // ---------------------------------------------------------
    // [기기 -> 서버 연결 시작] 시나리오
    // ---------------------------------------------------------

    // 기기에서 물리 버튼이 눌렸거나 타이머가 동작했을 때 호출된다고 가정
    @GetMapping("/action/connect")
    fun simulateConnectButton() {
        println("📡 [기기] 서버에 연결 요청을 보낸다.")

        val payload = DeviceEventRequest(
            deviceId = myDeviceId,
            eventType = "CONNECT", // StateMachine의 DeviceEvent.CONNECT와 매핑
            data = mapOf("ip" to "127.0.0.1", "port" to 8081)
        )

        // 서버로 POST 요청
        val response = restTemplate.postForObject(serverUrl, payload, ApiResponse::class.java)
        println("📥 [기기] 서버 응답 수신: ${response?.status}")
    }

    // ---------------------------------------------------------
    // [서버 -> 기기 연결 시작] 수신부
    // ---------------------------------------------------------

    // 기기 내부에 HTTP 서버가 떠 있어 서버의 명령을 POST로 받음
    @PostMapping("/command")
    fun receiveCommand(@RequestBody commandReq: ServerCommandRequest): ApiResponse {
        println("📥 [기기] 서버 명령 수신: ${commandReq.command}, 파라미터: ${commandReq.params}")

        // 실제 기기 제어 로직 (LED 켜기, 모터 돌리기 등)이 여기 들어감
        when (commandReq.command) {
            "TURN_ON"  -> println("💡 [기기] LED를 켠다.")
            "TURN_OFF" -> println("🌑 [기기] LED를 끈다.")
            else       -> println("❓ [기기] 알 수 없는 명령이다.")
        }

        return ApiResponse(status = "SUCCESS", message = "명령 수행 완료")
    }
}
```

### C. 관리 서버 측 코드 (Server Side)

서버는 기기의 이벤트를 받는 서버 역할과, 기기에 명령을 내리는 클라이언트 역할을 해요. 앞서 만든 StateMachine 로직과 통합되는 부분이에요.

```kotlin
package com.example.iot.server

import com.example.iot.common.ApiResponse
import com.example.iot.common.DeviceEventRequest
import com.example.iot.common.ServerCommandRequest
import com.example.iot.statemachine.DeviceEvent
import com.example.iot.service.DeviceStateMachineService // 앞서 만든 서비스
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.web.bind.annotation.*
import org.springframework.web.client.RestTemplate

@SpringBootApplication
class IotServerApplication

fun main(args: Array<String>) {
    // 서버는 8080 포트
    System.setProperty("server.port", "8080")
    runApplication<IotServerApplication>(*args)
}

@RestController
@RequestMapping("/api/server")
class ServerController(
    // 앞서 만든 StateMachine 제어 서비스 주입
    private val stateMachineService: DeviceStateMachineService
) {
    private val restTemplate = RestTemplate()

    // ---------------------------------------------------------
    // [기기 -> 서버 연결 시작] 수신부
    // ---------------------------------------------------------

    // 모든 기기로부터 오는 HTTP 이벤트를 중앙 수신
    @PostMapping("/event")
    fun receiveDeviceEvent(@RequestBody eventReq: DeviceEventRequest): ApiResponse {
        println("📥 [서버] 기기 ${eventReq.deviceId} 이벤트 수신: ${eventReq.eventType}")

        // 1. String 이벤트를 StateMachine Enum으로 변환
        val event = when (eventReq.eventType) {
            "CONNECT"     -> DeviceEvent.CONNECT
            "TEMP_REPORT" -> DeviceEvent.CONNECT_SUCCESS // 예시
            // ... 기타 매핑
            else -> null
        }

        if (event == null) {
            return ApiResponse(status = "FAIL", message = "Invalid Event Type")
        }

        // 2. 핵심: deviceId와 이벤트를 서비스에 전달해 상태 변경 트리거
        //    내부에서 factory.getStateMachine(deviceId) -> restore -> sendEvent -> interceptor 저장이 일어남
        val isAccepted = stateMachineService.sendEvent(eventReq.deviceId, event)

        return if (isAccepted) {
            ApiResponse(status = "SUCCESS", message = "이벤트 처리됨")
        } else {
            // 현재 상태에서 허용되지 않는 이벤트인 경우
            ApiResponse(status = "FAIL", message = "이벤트 거부됨 (현재 상태에서 불가)")
        }
    }

    // ---------------------------------------------------------
    // [서버 -> 기기 연결 시작] 시나리오 (관제자가 버튼 클릭)
    // ---------------------------------------------------------

    // 관리자 웹 대시보드에서 "기기 제어" 버튼을 눌렀을 때 호출된다고 가정
    @GetMapping("/action/control-device")
    fun controlDevice() {
        val targetDeviceId = "DEVICE-9901"
        println("📡 [서버] 기기 $targetDeviceId 에 제어 명령(TURN_ON) 전송.")

        // 실무에서는 DB에서 targetDeviceId의 최근 IP/Port를 조회해야 함
        val deviceIp = "localhost"
        val devicePort = 8081
        val deviceUrl = "http://$deviceIp:$devicePort/api/device/command"

        val payload = ServerCommandRequest(
            command = "TURN_ON",
            params = mapOf("brightness" to 100)
        )

        // 3. 기기 측 웹서버로 POST 요청 전송
        try {
            val response = restTemplate.postForObject(deviceUrl, payload, ApiResponse::class.java)
            println("📥 [서버] 기기 응답 수신: ${response?.status}")
        } catch (e: Exception) {
            println("❌ [서버] 기기 연결 실패: ${e.message}")
        }
    }
}
```

### 요약

- **양방향의 비밀** — HTTP 프로토콜 자체는 Req/Res 한 번으로 끝나지만, 서버와 기기 모두 수신부(웹서버)와 송신부(클라이언트)를 동시에 구현하면 양쪽 다 연결을 '시작'할 수 있게 돼요.
- **통합 포인트** — 기기가 서버로 `CONNECT` 요청을 보내면, 서버의 `ServerController`가 이를 받아 핵심 비즈니스 로직인 `DeviceStateMachineService`에 `deviceId`와 이벤트를 넘겨 상태를 중앙에서 관리해요.

이런 구조는 안 될 이유가 전혀 없고, 실제로 산업 현장에서 매우 활발하게 쓰이는 방식이에요.

---

## 9. 한 단계 더 — HTTP/2 스트리밍과 gRPC

HTTP/2의 스트리밍을 활용하면 HTTP/1.1의 비효율(거대한 텍스트 헤더, 매번 연결을 끊고 맺는 오버헤드)을 깔끔하게 해결할 수 있어요. HTTP/2는 멀티플렉싱(Multiplexing)과 바이너리 프레이밍을 지원해서, 단 하나의 TCP 연결 위에서 여러 독립 스트림(Stream)을 동시에 양방향으로 주고받아요.

### HTTP/2 스트리밍이 IoT 제어에 좋은 이유

**① HPACK (헤더 압축)**

HTTP/1.1은 매 요청마다 수백 바이트의 텍스트 헤더를 보냈지만, HTTP/2는 HPACK으로 헤더를 압축해요. 자주 쓰는 헤더는 중복으로 안 보내니까 네트워크 오버헤드가 웹소켓 수준으로 확 줄어들어요.

**② 스트림 멀티플렉싱 (Stream Multiplexing)**

하나의 연결 안에서 채널(Stream)을 분리할 수 있어요.

| 스트림 | 방향 | 용도 |
| --- | --- | --- |
| Stream 1 | 서버 → 자동차 | 실시간 조종 명령 |
| Stream 2 | 자동차 → 서버 | 센서/배터리 상태 보고 |
| Stream 3 | 자동차 → 서버 | 카메라 영상 스트리밍 |

**③ gRPC (HTTP/2 기반 최강자)**

HTTP/2 스트리밍을 직접 구현하기보다는, HTTP/2 + 양방향 스트리밍 + Protobuf(바이너리 직렬화)를 묶은 gRPC를 쓰는 게 실무 표준이에요.

- JSON 대신 바이너리로 주고받으니 메시지 크기가 몇 바이트 수준으로 작아져요.
- `Forward(speed=80)` 같은 함수를 서버/기기가 직접 호출하는 형태로 코드를 짤 수 있어 개발이 아주 편해요.

### 그래도 남는 치명적 약점 하나 — TCP Head-of-Line Blocking

HTTP/2 스트리밍도 정말 좋지만, **이동하는 장난감 자동차(Wi-Fi 환경)** 같은 상황에서는 한계가 있어요.

- **상황** — HTTP/2는 단 1개의 TCP 연결 위에 모든 스트림(조종·센서·영상)을 올려서 보내요.
- **문제** — 자동차가 이동하다 Wi-Fi 신호가 약해져 '센서 데이터 패킷 1개'를 유실했다고 해봐요.
- **결과** — TCP 특성상 손실된 패킷이 재전송돼 복구될 때까지, 뒤따라오던 '정지/좌회전' 조종 명령 패킷까지 함께 멈춰 서요(Blocking).
- **여파** — 조종 반응에 순간적으로 0.5~1초 이상의 랙(Jitter)이 생겨 자동차가 벽에 박을 위험이 있어요.

### 기술 선택 가이드

| 고려 요소 | WebSocket | HTTP/2 스트리밍 (gRPC) | WebRTC (UDP 기반) |
| --- | --- | --- | --- |
| 핵심 장점 | 가장 단순, 웹/IoT 생태계 지원 폭이 넓음 | 강력한 타입 체계(gRPC), 멀티플렉싱, 대용량 아키텍처에 유리 | 패킷 유실이 있어도 지연이 없어 가장 빠름 |
| 패킷 유실 시 | 해당 연결만 잠시 지연 | 모든 스트림이 함께 지연 (TCP HoL) | 유실 패킷은 버리고 다음 명령 즉시 수행 |
| 기기 리소스 | 매우 가벼움 | 약간의 CPU/메모리 필요 (HPACK, HTTP/2 파싱) | 상대적으로 무거움 |

---

## 실제 적용 계획

### 미니카 프로젝트
- wifi 연결된 IoT 디바이스 + 관제서버
  - HTTP/2(스트리머블 혹은 gRPC 양방향 스트리밍)
- Wi-Fi가 불안정해도 끊김 없는 최상의 반응 속도가 필요시
  -패킷을 좀 잃어도 최신 명령만 꽂아 넣는 UDP 기반 프로토콜(WebRTC / QUIC)
- 구성시 주요 결정사항
  - 보드 스펙(ESP32, 라즈베리파이, Linux 기반 싱글보드 등)
  - 통신관제 : gRPC/HTTP2 지원 여부는 하드웨어 종속
  - 보드 성능에 따른 트레이드오프가 있지만 최소한으로 경박단소하게, 되도록 Linux 가 아닌 RTOS 혹은 MCU 급에서 처리하면 쉽고 편하지 않을까?
  - 자동차의 경우 wifi 로 커버리지 충분하나, 항공기의 경우 WIFI 로는 불가하며 RF 필요 
