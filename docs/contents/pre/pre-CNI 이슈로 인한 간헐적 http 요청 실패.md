
## CNI 이슈로 인한 간헐적 http 요청 실패
[이슈]
내부/외부 http 통신이 간헐적으로 실패한다. 구조상 치명적이였음 (거대한 json 주고받기 때문에)  ->> TCP 덤프, LB로그, 방화벽로그
- 웹 앱 입장에서는 찍히지도 않고 안들어오는데, 보내는 측에서는 연결실패로 뜨니까 둘다 황당

[원인]
Cilium + CoreDNS 조합이슈
- 간헐적 timeout → 사실은 DNS resolve 실패
- policy mismatch → silently drop 임
- 원인은 eBPF 기반 라우팅(kube-proxy replacement) 버그때문

[해결법]
- Calico = 안정적이고 전통적인 네트워크 (iptables 기반)으로 변경
- iptables 많아지면 성능 떨어짐 / 실리움은 L7정책도 가능한데, 칼리코여서 L3&4정책만 가능
