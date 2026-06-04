# Ceryx v0.3 W7 Task6 Performance Results

## Context

- Generated at: 2026-06-04 18:19:59 +08:00
- Machine: LAPTOP-U5PORPA2
- OS: Microsoft Windows NT 10.0.26200.0
- Logical processors: 20
- Runtime: .NET 10.0.8
- Repo root: `D:\PrivateProjects\Ceryx_Project_Files\Ceryx\Ceryx_v0.2\CeryxProject`
- Test command: `dotnet test .\agent\windows\Ceryx.Agent.Windows.sln --filter Category=W7PerformanceMeasurement`

## Results

| Metric | Target | Measured | Result |
| --- | --- | --- | --- |
| Desktop local connect | <= 1000 ms | 0.05 ms (P95) | PASS |
| Paired iPad connect | <= 3000 ms | 0.44 ms (P95) | PASS |
| Input latency | <= 80 ms | 4.95 ms (P95) | PASS |
| Diff (5000 lines) | <= 1000 ms | 0.21 ms (P95) | PASS |
| Agent idle CPU | < 3% | 0.08% | PASS |
| Agent capture CPU | < 25% | 0.08% | PASS |

## Method

- Desktop local connect: repeated `GET /api/v1/health` latency over in-process Agent host (40 samples, 8 warmups).
- Paired iPad connect: repeated token-authenticated `GET /api/v1/agent/status` latency with iPad device identity (40 samples, 8 warmups).
- Input latency: repeated token-authenticated `POST /api/v1/input/text` latency with focused Codex snapshot (60 samples, 8 warmups).
- Diff latency: `GitDiffService.GetFileDiffAsync` for synthetic 5000-line diff payload (8 samples, 3 warmups).
- CPU idle/capture: process CPU usage from `TotalProcessorTime` over 5-second windows; capture workload sends 30Hz performance signals during active capture.

## Notes

- Measurements are deterministic integration benchmarks inside test host and are intended for regression comparison across W7/W8.
- If any target fails, capture the host logs and rerun under the same load profile before release acceptance.
