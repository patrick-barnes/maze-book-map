import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import * as d3 from 'd3';
import { Connection, Room } from './models';

interface PositionedRoom extends Room, d3.SimulationNodeDatum {
  x: number;
  y: number;
}

type GraphLink = d3.SimulationLinkDatum<PositionedRoom>;

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  @ViewChild('graph', { static: true })
  private readonly graphElement!: ElementRef<SVGSVGElement>;

  protected readonly errorMessage = signal('');
  protected readonly isLoading = signal(true);

  private readonly http = inject(HttpClient);
  private simulation?: d3.Simulation<PositionedRoom, undefined>;
  private allRooms: Room[] = [];
  private allConnections: Connection[] = [];
  private readonly visibleRoomKeys = new Set(['04']);
  private readonly visibleConnectionKeys = new Set<string>();
  private readonly expandedRoomKeys = new Set<string>();
  private readonly roomPositions = new Map<string, { x: number; y: number }>();

  ngAfterViewInit(): void {
    this.loadGraph();
  }

  ngOnDestroy(): void {
    this.simulation?.stop();
  }

  private async loadGraph(): Promise<void> {
    try {
      const [rooms, connections] = await Promise.all([
        this.http.get<Room[]>('/rooms.json').toPromise(),
        this.http.get<Connection[]>('/connections.json').toPromise(),
      ]);

      if (!rooms || !connections) {
        throw new Error('Graph data was empty.');
      }

      this.allRooms = rooms;
      this.allConnections = this.makeBidirectional(connections);
      this.renderVisibleGraph();
    } catch {
      this.errorMessage.set('The graph data could not be loaded.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private renderVisibleGraph(): void {
    this.simulation?.stop();

    const svg = d3.select(this.graphElement.nativeElement);
    const width = this.graphElement.nativeElement.clientWidth;
    const height = this.graphElement.nativeElement.clientHeight;
    const positionedRooms: PositionedRoom[] = this.allRooms
      .filter((room) => this.visibleRoomKeys.has(room.key))
      .map((room) => {
        const position = this.roomPositions.get(room.key) ?? {
          x: 28 + Math.random() * Math.max(width - 56, 1),
          y: 28 + Math.random() * Math.max(height - 56, 1),
        };
        this.roomPositions.set(room.key, position);
        return { ...room, ...position };
      });
    const visibleRoomKeys = new Set(positionedRooms.map((room) => room.key));
    const links: GraphLink[] = this.allConnections
      .filter((connection) => this.visibleConnectionKeys.has(this.connectionKey(connection)))
      .filter((connection) => visibleRoomKeys.has(connection.from) && visibleRoomKeys.has(connection.to))
      .map((connection) => ({ source: connection.from, target: connection.to }));

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    const linkSelection = svg
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line');

    const nodes = svg
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, PositionedRoom>('g')
      .data(positionedRooms)
      .join('g')
      .attr('transform', (room) => `translate(${room.x}, ${room.y})`);

    nodes
      .classed('expanded', (room) => this.expandedRoomKeys.has(room.key))
      .style('cursor', 'grab')
      .on('click', (_, room) => this.revealConnections(room.key));

    nodes
      .call(
        d3
          .drag<SVGGElement, PositionedRoom>()
          .on('start', (event, room) => {
            if (!event.active) {
              this.simulation?.alphaTarget(0.2).restart();
            }
            room.fx = room.x;
            room.fy = room.y;
            d3.select(event.sourceEvent.currentTarget as SVGGElement).style('cursor', 'grabbing');
          })
          .on('drag', (event, room) => {
            room.fx = event.x;
            room.fy = event.y;
            this.roomPositions.set(room.key, { x: event.x, y: event.y });
          })
          .on('end', (event, room) => {
            if (!event.active) {
              this.simulation?.alphaTarget(0);
            }
            room.fx = null;
            room.fy = null;
            d3.select(event.sourceEvent.currentTarget as SVGGElement).style('cursor', 'grab');
          }),
      );

    nodes.append('circle').attr('r', 18);
    nodes
      .append('text')
      .text((room) => room.key)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central');

    this.simulation = d3
      .forceSimulation(positionedRooms)
      .force(
        'link',
        d3
          .forceLink<PositionedRoom, GraphLink>(links)
          .id((room) => room.key)
          .distance(82)
          .strength(0.55),
      )
      .force('charge', d3.forceManyBody<PositionedRoom>().strength(-750))
      .force('collision', d3.forceCollide<PositionedRoom>(22))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .on('tick', () => {
        linkSelection
          .attr('x1', (link) => (link.source as PositionedRoom).x)
          .attr('y1', (link) => (link.source as PositionedRoom).y)
          .attr('x2', (link) => (link.target as PositionedRoom).x)
          .attr('y2', (link) => (link.target as PositionedRoom).y);

        nodes.attr('transform', (room) => `translate(${room.x}, ${room.y})`);

        for (const room of positionedRooms) {
          this.roomPositions.set(room.key, { x: room.x, y: room.y });
        }
      });
  }

  private revealConnections(roomKey: string): void {
    if (this.expandedRoomKeys.has(roomKey)) {
      return;
    }

    this.expandedRoomKeys.add(roomKey);

    for (const connection of this.allConnections) {
      if (connection.from === roomKey || connection.to === roomKey) {
        this.visibleRoomKeys.add(connection.from);
        this.visibleRoomKeys.add(connection.to);
        this.visibleConnectionKeys.add(this.connectionKey(connection));
      }
    }

    this.renderVisibleGraph();
  }

  private connectionKey(connection: Connection): string {
    return `${connection.from}->${connection.to}`;
  }

  private makeBidirectional(connections: Connection[]): Connection[] {
    const connectionKeys = new Set(
      connections.map((connection) => `${connection.from}->${connection.to}`),
    );
    const bidirectionalConnections = [...connections];

    for (const connection of connections) {
      const reverseKey = `${connection.to}->${connection.from}`;
      if (!connectionKeys.has(reverseKey)) {
        bidirectionalConnections.push({
          ...connection,
          from: connection.to,
          to: connection.from,
        });
        connectionKeys.add(reverseKey);
      }
    }

    return bidirectionalConnections;
  }
}
