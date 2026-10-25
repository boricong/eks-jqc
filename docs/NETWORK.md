# LAN 실행과 WSL 포트 전달

## 실행 주소

Node 24를 사용한다. 기존 데이터를 사용하는 경우 `data:init`이나 이관 명령을 다시 실행하지 않는다.

| 명령                           | 웹앱 수신       | API 수신         | 브라우저 접속        |
| ------------------------------ | --------------- | ---------------- | -------------------- |
| `npm run dev`                  | `0.0.0.0:5186`  | `127.0.0.1:5187` | `http://서버IP:5186` |
| `npm run build` 후 `npm start` | API와 같은 서버 | `0.0.0.0:5187`   | `http://서버IP:5187` |

`0.0.0.0`은 모든 IPv4 인터페이스의 수신 설정이며 브라우저 접속 주소가 아니다. 공동 사용은 빌드된 앱의 단일5187포트 구성을 권장한다. 개발 서버는 소스와 HMR도 제공한다. Vite preview는 로컬 확인용이며 운영 용도로 사용하지 않는다.

서버 IP가 바뀌어도 앱 설정을 변경할 필요는 없다. 사용자는 새 주소로 접속해야 하고, 브라우저 저장소·쿠키는 주소별로 구분되므로 계정을 다시 선택한다. 페이지를 닫기 전에 미저장 입력을 저장한다. 시작 로그의 주소는 현재 OS의 접속 후보일 뿐 방화벽 통과를 보장하지 않으며 WSL 로그에 Windows IP가 자동 표시되지는 않는다.

## 환경변수

환경변수는 실행 셸 또는 프로세스 관리자에서 전달한다. 서버가 `.env` 파일을 자동 로드한다고 가정하지 않는다.

| 변수                                       | 기본값/동작                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `FRONTEND_HOST`                            | 개발 웹앱 `0.0.0.0`                                                                                              |
| `FRONTEND_PORT`                            | 개발 웹앱 `5186`                                                                                                 |
| `API_HOST`                                 | `npm start`는 `0.0.0.0`, 루트 `npm run dev`의 자식 API는 `127.0.0.1`                                             |
| `API_PORT`                                 | `5187`; 개발 프록시의 기본 목적지 포트도 함께 변경                                                               |
| `API_TARGET`                               | 개발 프록시 목적지를 명시적으로 재정의. 미지정 시 API_HOST/API_PORT 사용(전체 인터페이스 주소는 루프백으로 연결) |
| `FRONTEND_ORIGIN`                          | 선택적인 추가 허용 HTTP(S) 출처 한 개. 포트 포함, 경로·쿼리·사용자정보·와일드카드 불가                           |
| `EKS_DATA_FILE` / `EKS_ORGANIZATIONS_FILE` | 기존 업무·조직 데이터 경로; 두 값을 모두 보존하며 네트워크 설정 때문에 변경하지 않음                             |

로컬 전용 실행 예시:

```sh
FRONTEND_HOST=127.0.0.1 API_HOST=127.0.0.1 npm run dev
API_HOST=127.0.0.1 npm start
```

PowerShell에서는 `$env:API_HOST = '127.0.0.1'`처럼 설정한 후 `npm.cmd start`를 실행한다. 기본으로 복귀하려면 해당 환경변수를 제거한다.

## 요청 검증과 접근 범위

입력은 실제 HTTP `Host`, 요청 프로토콜, 변경 요청의 `Origin`, 명시적인 추가 허용 출처다. 결과는 요청 통과 또는403 거부다.

- `localhost`, IPv4 루프백, `::1`, 사설 IPv4(10/8, 172.16/12, 192.168/16)를 자동 허용한다. 임의 도메인·공인 IP는 기본 거부한다. 명시 출처로 등록한 호스트는 예외로 허용한다.
- 변경 요청에 Origin이 있으면 프로토콜·호스트·포트가 접속 주소와 일치하거나 명시 추가 허용 출처와 정확히 일치해야 한다. 사설 IP 간에도 다른 출처는 자동 허용하지 않는다.
- 잘못된 Host, 축약/정수 IP 표기, `Origin: null`·빈 값·경로가 있는 출처를 거부한다. 설정 자체가 잘못되면 시작 전에 실패한다.
- Origin 없는 기존 비브라우저 호출은 유지한다. 모든 업무의 기존 세션·권한·중복 처리 방지는 그대로 적용한다.
- `Forwarded`/`X-Forwarded-*`를 신뢰해 우회하지 않는다. Vite 프록시는 Host·Origin을 변경하지 않는다. TCP 포트 전달은 외부 Host·Origin을 유지하므로 외부 포트와 내부 포트가 달라도 동작한다.
- 이는 클라이언트 IP 접근 제어가 아니다. 방화벽에서 허용할 사내 대역과 서비스 포트를 제한한다. 호스트/출처를 위조할 수 있는 비브라우저 클라이언트에 대한 사용자 인증을 대신하지 않는다. 현재 계정 선택은 MVP용이며 사내 SSO가 아니다.
- 이번 구성은 HTTP와 TCP 전달이다. HTTPS 종료 리버스 프록시는 별도 신뢰 프록시·프로토콜 설계가 필요하다. HTTP에서는 통신 암호화가 제공되지 않는다.

HTTP 사설 IP 접속에서는 브라우저 `crypto.randomUUID`가 제공되지 않을 수 있어 암호학적 `getRandomValues`로 같은 UUID v4 형식을 생성한다. `Math.random`으로 대체하지 않는다. 클립보드 복사도 HTTP에서 제한될 수 있으며 기존 실패 안내와 URL 직접 선택 복사를 사용한다.

## Windows + WSL2 NAT 수동 설정

WSL에서 먼저 앱을 실행한다. 빌드 실행은5187, 개발 실행은5186만 Windows에서 전달한다. 개발 API5187은 전달하지 않는다. 아래는 빌드 실행5187의 예시다. Windows IP Helper 서비스가 실행 중이어야 하며 해당 포트를 다른 Windows 서비스가 점유하지 않아야 한다.

1. Windows PowerShell에서 `wsl.exe -l -v`로 배포판 이름을 확인하고 `wsl.exe -d Ubuntu hostname -I`로 WSL IP를 확인한다. `Ubuntu`는 실제 이름으로 바꾼다. 여러 주소가 나오면 Windows에서 접근할 수 있는 WSL 인터페이스의 IPv4 하나를 선택한다.
2. 관리자 PowerShell에서 실제 WSL IP를 지정하고 전달 규칙을 등록한다.

```powershell
$EksWslIp = '172.28.100.10' # 실제 WSL IPv4로 교체
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5187 connectaddress=$EksWslIp connectport=5187 protocol=tcp
```

3. 실제 접속할 사내 대역에만 Windows 방화벽을 허용한다. 아래 예시 CIDR은 반드시 환경에 맞게 바꾼다. 이미 같은 이름의 규칙이 있으면 중복 생성하지 않고 기존 규칙을 확인한다.

```powershell
New-NetFirewallRule -Name 'EKS-Web-5187' -DisplayName 'EKS Web 5187' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5187 -RemoteAddress '192.168.0.0/24' -Profile Domain,Private
```

WSL 내부 또는 Hyper-V 방화벽이 적용된 환경은 해당 서비스 포트도 확인한다. 방화벽 전체 비활성화나 전체 포트 허용은 하지 않는다.

4. `ipconfig`로 Windows LAN IP를 확인하고 `http://Windows-IP:5187`로 접속한다. Windows에서 `Test-NetConnection $EksWslIp -Port 5187`, 접속할 다른 PC에서 `Test-NetConnection <Windows-IP> -Port 5187`로 구간별 연결을 확인한다. `netsh interface portproxy show v4tov4`로 전달 목적지를 확인한다.
5. WSL 재시작 후 IP가 바뀌면 앱 설정이 아닌 전달 규칙만 갱신한다.

```powershell
$EksWslIp = '172.28.100.20' # 변경된 실제 WSL IPv4
netsh interface portproxy set v4tov4 listenaddress=0.0.0.0 listenport=5187 connectaddress=$EksWslIp connectport=5187 protocol=tcp
```

필요 없어졌을 때 이 서비스 규칙만 제거한다.

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=5187
Remove-NetFirewallRule -Name 'EKS-Web-5187'
```

Windows IP가 바뀌어도 전체 인터페이스 수신 규칙은 유지되지만 브라우저 주소를 변경해야 한다. WSL IP가 바뀌면 목적지를 갱신해야 한다. 사내 IP 대역이 바뀌면 방화벽 범위도 검토한다. WSL 설정이나 이 규칙은 앱이 자동 변경하지 않는다.

공식 참고: [Microsoft WSL 네트워크](https://learn.microsoft.com/windows/wsl/networking), [TCP portproxy](https://learn.microsoft.com/windows-server/networking/technologies/netsh/netsh-interface-portproxy), [Vite 서버 설정](https://vite.dev/config/server-options).
