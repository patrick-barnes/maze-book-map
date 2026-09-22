import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import * as d3 from 'd3';
import { Connection, Room } from './models';

interface PositionedRoom extends Room {
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

      this.drawGraph(rooms, this.makeBidirectional(connections));
    } catch {
      this.errorMessage.set('The graph data could not be loaded.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private drawGraph(rooms: Room[], connections: Connection[]): void {
    const svg = d3.select(this.graphElement.nativeElement);
    const width = this.graphElement.nativeElement.clientWidth;
    const height = this.graphElement.nativeElement.clientHeight;
    const positionedRooms: PositionedRoom[] = rooms.map((room) => ({
      ...room,
      x: 28 + Math.random() * Math.max(width - 56, 1),
      y: 28 + Math.random() * Math.max(height - 56, 1),
    }));
    const links: GraphLink[] = connections.flatMap((connection) => {
      const source = positionedRooms.find((room) => room.key === connection.from);
      const target = positionedRooms.find((room) => room.key === connection.to);
      return source && target ? [{ source: connection.from, target: connection.to }] : [];
    });

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
      .selectAll('g')
      .data(positionedRooms)
      .join('g')
      .attr('transform', (room) => `translate(${room.x}, ${room.y})`);

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
      });
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
